/**
 * TLS settings for the Postgres pool (server/db.ts).
 *
 * Default (no DATABASE_CA_CERT): encrypted but the server's certificate is NOT checked —
 * exactly the old `ssl: { rejectUnauthorized: false }`. Anyone able to intercept the
 * connection could read queries and the DB password, so this logs a warning.
 *
 * With DATABASE_CA_CERT set to Supabase's CA certificate (Dashboard → Project Settings →
 * Database → SSL Configuration → Download certificate), the server must present a chain
 * signed by that CA, or the connection is refused. Accepted forms, because env-var UIs
 * mangle newlines differently:
 *   - the PEM text itself (real newlines, or literal "\n" sequences), or
 *   - the PEM text base64-encoded (one line, no spaces).
 *
 * Pure: `dbSslConfig(env)` reads nothing else — locked by scripts/verify-db-ssl.ts.
 */

export type DbSslConfig =
  | { mode: "unverified"; ssl: { rejectUnauthorized: false } }
  | { mode: "verified"; ssl: { rejectUnauthorized: true; ca: string } }
  | { mode: "invalid"; error: string };

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

export function normalizeCaCert(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (!text.includes("-----BEGIN")) {
    // Maybe base64 of the PEM.
    try {
      const decoded = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
      if (decoded.includes("-----BEGIN CERTIFICATE-----")) text = decoded.trim();
    } catch {
      return null;
    }
  }
  text = text.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  return PEM_RE.test(text) ? text + (text.endsWith("\n") ? "" : "\n") : null;
}

export function dbSslConfig(env: Record<string, string | undefined>): DbSslConfig {
  const raw = env.DATABASE_CA_CERT;
  if (raw == null || raw.trim() === "") {
    return { mode: "unverified", ssl: { rejectUnauthorized: false } };
  }
  const ca = normalizeCaCert(raw);
  if (!ca) {
    return {
      mode: "invalid",
      error:
        "DATABASE_CA_CERT is set but is not a PEM certificate (or base64 of one). " +
        "Paste the contents of Supabase's downloaded .crt file, or clear the variable.",
    };
  }
  return { mode: "verified", ssl: { rejectUnauthorized: true, ca } };
}

/** Remove ssl* query params (sslmode, sslrootcert, sslcert, sslkey, ssl) from a Postgres URL. */
export function stripSslParams(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const kept = url
    .slice(q + 1)
    .split("&")
    .filter((kv) => kv && !/^ssl[a-z]*=/i.test(kv) && !/^ssl$/i.test(kv));
  return url.slice(0, q) + (kept.length ? "?" + kept.join("&") : "");
}
