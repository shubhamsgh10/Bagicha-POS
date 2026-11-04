// Read-only check that the app can reach the database with TLS certificate verification ON.
// Run on a machine with a DIRECT connection to Supabase (not through an inspecting proxy):
//
//   npx tsx -r dotenv/config scripts/check-db-tls.ts --ca path/to/prod-ca-2021.crt
//   (or set DATABASE_CA_CERT in .env and drop --ca)
//
// It does three things, and writes nothing:
//   1. connects exactly the way server/db.ts will (stripSslParams + dbSslConfig) and runs
//      SELECT 1 plus a pg_stat_ssl read, printing the certificate chain the server presented;
//   2. NEGATIVE CONTROL: connects again trusting a public root CA that did NOT sign Supabase's
//      certificate. That MUST fail — if it connects, verification is not actually happening;
//   3. prints a verdict. Exit code 0 only when (1) passed and (2) was refused.
import fs from "node:fs";
import tls from "node:tls";
import pkg from "pg";
import { dbSslConfig, stripSslParams } from "../server/dbSsl";

const { Client } = pkg;

const argCa = (() => { const i = process.argv.indexOf("--ca"); return i > 0 ? process.argv[i + 1] : undefined; })();
const env = { ...process.env };
if (argCa) env.DATABASE_CA_CERT = fs.readFileSync(argCa, "utf8");

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set (run with -r dotenv/config from the repo root)."); process.exit(2); }
const cfg = dbSslConfig(env);
if (cfg.mode !== "verified") {
  console.error(cfg.mode === "invalid" ? cfg.error : "No CA given: pass --ca <file> or set DATABASE_CA_CERT.");
  process.exit(2);
}
const host = new URL(url).hostname;
console.log(`Host: ${host}`);

const EXPLAIN: Record<string, string> = {
  SELF_SIGNED_CERT_IN_CHAIN: "the server's chain is not signed by the CA you gave (wrong certificate file, or an inspecting proxy/antivirus on this network).",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the server's certificate is not signed by the CA you gave.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "the CA you gave is not the one that issued the server's certificate.",
  ERR_TLS_CERT_ALTNAME_INVALID: "the certificate is valid but not for this host name — check the host in DATABASE_URL.",
  CERT_HAS_EXPIRED: "a certificate in the chain has expired.",
};

function describeChain(client: any): void {
  const sock = client?.connection?.stream as tls.TLSSocket | undefined;
  if (!sock || typeof sock.getPeerCertificate !== "function") return;
  let c: any = sock.getPeerCertificate(true); const seen = new Set<string>(); let i = 0;
  while (c && c.fingerprint256 && !seen.has(c.fingerprint256)) {
    seen.add(c.fingerprint256);
    console.log(`    [${i++}] ${c.subject?.CN}  ←  issued by ${c.issuer?.CN}  (valid to ${c.valid_to})`);
    c = c.issuerCertificate;
  }
}

async function attempt(label: string, ssl: object): Promise<{ ok: boolean; code?: string; msg?: string }> {
  const client = new Client({ connectionString: stripSslParams(url!), ssl, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    const r = await client.query(
      "select 1 as one, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl, " +
      "(select version from pg_stat_ssl where pid = pg_backend_pid()) as tls_version",
    );
    console.log(`  ${label}: connected — SELECT 1 = ${r.rows[0].one}, ssl=${r.rows[0].ssl}, ${r.rows[0].tls_version ?? "?"}`);
    describeChain(client);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, code: e?.code, msg: e?.message };
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  console.log("\n1) With DATABASE_CA_CERT (what server/db.ts will do):");
  const real = await attempt("verified", cfg.ssl);
  if (!real.ok) {
    console.log(`  FAILED: ${real.code ?? ""} ${real.msg}`);
    if (real.code && EXPLAIN[real.code]) console.log(`  → ${EXPLAIN[real.code]}`);
  }

  console.log("\n2) Negative control (trusting an unrelated public root CA — must be REFUSED):");
  const wrongCa = tls.rootCertificates.find((p) => !p.includes("Supabase")) ?? tls.rootCertificates[0];
  const neg = await attempt("wrong CA", { rejectUnauthorized: true, ca: wrongCa });
  // Only a CERTIFICATE rejection proves verification works — "host not found" or a timeout
  // proves nothing, so they don't count as a refusal.
  const certRejected = !neg.ok && (
    (!!neg.code && neg.code in EXPLAIN) || /certificate|self.signed|issuer/i.test(neg.msg ?? "")
  );
  if (neg.ok) console.log("  !! connected with the WRONG CA — verification is not in effect");
  else if (certRejected) console.log(`  refused as expected (${neg.code ?? neg.msg})`);
  else console.log(`  inconclusive — failed for a non-certificate reason: ${neg.code ?? ""} ${neg.msg}`);

  const pass = real.ok && certRejected;
  console.log(`\nVERDICT: ${pass ? "PASS — safe to set DATABASE_CA_CERT in this environment." : "FAIL — do not set DATABASE_CA_CERT yet."}`);
  process.exit(pass ? 0 : 1);
})();
