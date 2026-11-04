# Full-app line-by-line review — agent instructions

App: Bagicha POS, a restaurant POS (React client in `client/`, Express server in `server/`,
shared pure logic in `shared/`, Electron desktop in `desktop/`). It runs on Vercel + Supabase
Postgres and handles real money (orders, settlement, write-offs), the kitchen (KOT tickets,
thermal printing) and staff auth (PIN elevation). `CLAUDE.md` at the repo root documents the
invariants, intended behaviour and ACCEPTED KNOWN GAPS — read the sections relevant to your
files before judging. Never report something CLAUDE.md describes as intended or as a known,
deliberately-deferred gap.

Hard rules: read-only on the codebase. No DB access, no network, no starting servers, no
installs. The ONLY file you may write is the output file named in your task. Use
`Array.from` thinking: `tsconfig` has no target (ES5) — iterating a Map/Set with for…of is a bug.

## Reviewer (task names a slice id, e.g. R03)
1. Look up your slice in `docs/review/slices.json` (`files` = `path:startLine-endLine`).
2. Read EVERY line of every range with the Read tool (offset/limit for ranges). Do not skim.
3. Grep for callers/callees only when needed to decide if a defect is reachable.
4. Look for: wrong results, crashes, data loss, money errors (totals, tax, discount,
   settlement, write-off, double-settle), auth/IDOR/elevation gaps, CSRF/XSS/injection,
   races (lost updates, double-fire, check-then-act without a lock), unawaited promises on
   money/audit paths, timezone (must be IST/business-day helpers), broken error handling
   (exception → wrong status, swallowed errors that hide failures), resource leaks, stale
   closures/effects/missing cleanup in React, unbounded polling or refetching, extra serial
   DB round trips / N+1 / SELECT * on hot paths, accessibility blockers. Skip pure style.
5. Every finding must name a concrete input/state → wrong outcome. If you can't, drop it.
6. Write `docs/review/<ID>.findings.json`:
   `{ "slice": "<ID>", "coverage": "<every file/range you read, and anything you could not>",
      "findings": [ { "file", "line", "severity": "critical|high|medium|low", "category",
      "title", "detail", "failure_scenario", "suggested_fix" } ] }`
   Severity: critical = money/security/data loss reachable in normal use; high = wrong
   behaviour staff will hit; medium = edge case or latency cost; low = minor.
7. Reply with one line: the count by severity.

## Checker (task names a slice id)
1. Read `docs/review/<ID>.findings.json`. You did NOT write it; your default for EACH
   finding is to REFUTE it.
2. For each finding, read the actual code yourself (and callers, middleware, client gates,
   DB constraints, CLAUDE.md) and decide: is the defect real, reachable in this app's real
   flows, and not documented as intended or as an accepted known gap? Re-rate severity
   honestly. Judge each independently.
3. Write `docs/review/<ID>.verified.json`: the same object, each finding gaining
   `"real": true|false, "verified_severity": "...", "reason": "<what you checked>"`.
4. Reply with one line: confirmed / refuted counts.
