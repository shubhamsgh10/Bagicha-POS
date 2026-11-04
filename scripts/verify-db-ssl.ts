// DB-free checks for server/dbSsl.ts (the DATABASE_CA_CERT switch).
import { dbSslConfig, normalizeCaCert, stripSslParams } from "../server/dbSsl";

let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failed++; };

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUabc\n-----END CERTIFICATE-----";

ok(dbSslConfig({}).mode === "unverified", "no DATABASE_CA_CERT → unverified (old behaviour)");
ok(dbSslConfig({ DATABASE_CA_CERT: "   " }).mode === "unverified", "blank DATABASE_CA_CERT → unverified");
{
  const c = dbSslConfig({});
  ok(c.mode === "unverified" && c.ssl.rejectUnauthorized === false, "unverified keeps rejectUnauthorized:false");
}
{
  const c = dbSslConfig({ DATABASE_CA_CERT: PEM });
  ok(c.mode === "verified" && c.ssl.rejectUnauthorized === true && c.ssl.ca.startsWith("-----BEGIN"), "PEM → verified with ca");
}
ok(normalizeCaCert(PEM.replace(/\n/g, "\\n")) === PEM + "\n", "literal \\n sequences become newlines");
ok(normalizeCaCert(Buffer.from(PEM).toString("base64")) === PEM + "\n", "base64 of the PEM is accepted");
ok(normalizeCaCert(PEM.replace(/\n/g, "\r\n")) === PEM + "\n", "CRLF normalised");
ok(dbSslConfig({ DATABASE_CA_CERT: "not a cert" }).mode === "invalid", "garbage → invalid (refuse to boot, never silently unverified)");
ok(dbSslConfig({ DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----" }).mode === "invalid", "truncated PEM → invalid");

ok(stripSslParams("postgres://u:p@h:6543/db") === "postgres://u:p@h:6543/db", "URL without params unchanged");
ok(stripSslParams("postgres://u:p@h:6543/db?sslmode=require") === "postgres://u:p@h:6543/db", "sslmode removed");
ok(stripSslParams("postgres://u:p@h/db?pgbouncer=true&sslmode=no-verify&sslrootcert=x") === "postgres://u:p@h/db?pgbouncer=true", "other params kept, ssl* removed");
ok(stripSslParams("postgres://u:p@h/db?SSLMODE=require&application_name=pos") === "postgres://u:p@h/db?application_name=pos", "case-insensitive");

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll db-ssl checks passed");
