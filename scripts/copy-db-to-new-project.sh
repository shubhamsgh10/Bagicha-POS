#!/usr/bin/env bash
# Copy the app's data from one Supabase project to another (the `public` schema: all 40 app tables,
# their rows, sequences, indexes, constraints and RLS flags). Nothing else in the source is used by the
# app: auth.users and storage.objects are empty, and there are no functions/triggers/views/policies.
#
# URLs come from the environment or the gitignored .env — never paste them into this file:
#   SOURCE_DATABASE_URL   old project (defaults to DATABASE_URL)
#   TARGET_DATABASE_URL   new project — the Supabase "Session pooler" (or transaction pooler) string.
#                         The direct db.<ref>.supabase.co host is IPv6-only and often unreachable.
#
# Usage:
#   scripts/copy-db-to-new-project.sh             preflight only (read-only on both sides)
#   scripts/copy-db-to-new-project.sh --confirm   dump the source, restore into the target, verify
#   scripts/copy-db-to-new-project.sh --verify    compare exact row counts + sequences, source vs target
#
# Safety:
#   - The source is only ever read (pg_dump runs in a read-only snapshot).
#   - The restore refuses a target whose public schema already has tables, and runs as ONE
#     transaction: any error rolls the whole thing back and leaves the target empty.
#   - The dump is kept in backups/ (gitignored: customer phones, staff PINs — never commit it).
#   - Writes made to the source AFTER the dump are not copied. Run it while the restaurant is closed,
#     then switch DATABASE_URL everywhere straight away (see the checklist printed at the end).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
SRC="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
DST="${TARGET_DATABASE_URL:-}"
[ -n "$SRC" ] || { echo "SOURCE_DATABASE_URL / DATABASE_URL is not set"; exit 1; }
[ -n "$DST" ] || { echo "TARGET_DATABASE_URL is not set (add it to .env)"; exit 1; }

# pg_dump/pg_restore want a session, not Supabase's transaction pooler (port 6543): use the session
# pooler on the same host (port 5432) instead.
session_url() { printf '%s' "$1" | sed -E 's#(pooler\.supabase\.com):6543#\1:5432#'; }
SRC="$(session_url "$SRC")"
DST="$(session_url "$DST")"
mask() { printf '%s' "$1" | sed -E 's#//([^:/]+):[^@]*@#//\1:***@#'; }
export PGCONNECT_TIMEOUT=20
q() { psql "$1" -X -q -At -v ON_ERROR_STOP=1 -c "$2"; }

if [ "$(mask "$SRC")" = "$(mask "$DST")" ]; then echo "Source and target are the same database — refusing."; exit 1; fi

public_tables() { q "$1" "select count(*) from pg_tables where schemaname='public'"; }

# Exact per-table row counts + sequence positions, one line each, sorted — diffable across databases.
fingerprint() {
  psql "$1" -X -q -At -v ON_ERROR_STOP=1 <<'SQL'
set default_transaction_read_only = on;
select format('select %L || '' rows='' || count(*) from public.%I', tablename, tablename)
  from pg_tables where schemaname = 'public' order by tablename \gexec
select 'seq ' || sequencename || ' last=' || coalesce(last_value::text, 'unset')
  from pg_sequences where schemaname = 'public' order by sequencename;
SQL
}

verify() {
  local a b
  a="$(fingerprint "$SRC")"; b="$(fingerprint "$DST")"
  if [ "$a" = "$b" ]; then
    echo "VERIFY OK: $(printf '%s\n' "$a" | grep -c ' rows=') tables and $(printf '%s\n' "$a" | grep -c '^seq ') sequences match exactly."
    return 0
  fi
  echo "VERIFY MISMATCH (source < > target):"
  diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") || true
  return 1
}

echo "Source: $(mask "$SRC")"
echo "Target: $(mask "$DST")"
# Fail loudly on an unreachable database (a command substitution inside echo would swallow the error).
# Supabase's direct host (db.<ref>.supabase.co) is IPv6-only: from an IPv4-only network use the
# Session pooler string from Supabase → Connect instead.
for side in Source:"$SRC" Target:"$DST"; do
  if ! q "${side#*:}" 'select 1' >/dev/null; then echo "Cannot connect to ${side%%:*} database — aborting."; exit 1; fi
done
echo "Source: $(q "$SRC" 'show server_version'), $(public_tables "$SRC") public tables, $(q "$SRC" 'select pg_size_pretty(pg_database_size(current_database()))')"
echo "Target: $(q "$DST" 'show server_version'), $(public_tables "$DST") public tables"
echo "pg_dump: $(pg_dump --version)"

case "${1:-}" in
  --verify) verify; exit $? ;;
  --confirm) ;;
  "") echo; echo "Preflight OK. Re-run with --confirm to copy."; exit 0 ;;
  *) echo "Unknown option: $1"; exit 1 ;;
esac

if [ "$(public_tables "$DST")" != "0" ]; then
  echo "Target already has tables in public — refusing to restore over them."; exit 1
fi

mkdir -p backups
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="backups/supabase-public-$TS.dump"
LIST="backups/supabase-public-$TS.list"

echo; echo "1/3 Dumping source public schema -> $DUMP"
pg_dump "$SRC" --schema=public --format=custom --no-owner --no-privileges --file="$DUMP"

# The target already has a public schema (and its comment) — skip those two entries, restore the rest.
pg_restore --list "$DUMP" | grep -vE ' SCHEMA - public | COMMENT - SCHEMA public ' > "$LIST"
echo "   $(grep -c ' TABLE DATA ' "$LIST") tables of data, $(wc -c < "$DUMP" | tr -d ' ') bytes"

echo "2/3 Restoring into target (single transaction)"
pg_restore --dbname="$DST" --use-list="$LIST" --no-owner --no-privileges --single-transaction --exit-on-error "$DUMP"

echo "3/3 Verifying"
verify

cat <<EOF

Copied. Now switch DATABASE_URL to the new project everywhere, then re-run --verify only if nothing
has written to the old project since the dump:
  - Vercel: Project → Settings → Environment Variables → DATABASE_URL, then redeploy
    (keep the transaction-pooler URL, port 6543, for the app itself).
  - This machine's .env (and any other developer machine).
  - Electron host builds: DATABASE_URL is baked in at package time, or set in
    <userData>/host-config.json on the host PC — update that file, or rebuild.
Dump kept at $DUMP (gitignored).
EOF
