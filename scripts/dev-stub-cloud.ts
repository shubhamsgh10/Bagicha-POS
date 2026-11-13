// Manual smoke-test tool: a stand-in "cloud" for the desktop app's local mode. In-memory PGlite
// serving the real snapshot/pull SQL (like scripts/verify-local-sync.ts), nothing else. Never touches
// Supabase or .env.   Usage: npx tsx scripts/dev-stub-cloud.ts [port=5190]
// Device token: 64 x "a".  Cloud URL for host-config.json: http://127.0.0.1:<port>
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { schemaStatements } from "./lib/pgliteSchema";
import { migrationStatements, snapshotSelectSql } from "../server/sync/changeLogSql";
import { SYNC_TABLES } from "../shared/syncTables";

const port = Number(process.argv[2] || 5190);
const TOKEN = "a".repeat(64);

async function main() {
  const db = new PGlite();
  await db.waitReady;
  for (const s of await schemaStatements()) await db.exec(s);
  for (const s of migrationStatements()) await db.exec(s);
  const q = async (sql: string) => (await db.query<any>(sql)).rows;
  await q(`INSERT INTO users (username, password, role, pin) VALUES ('boss','scrypt','admin','1111')`);
  await q(`INSERT INTO categories (name) VALUES ('Pizza')`);
  await q(`INSERT INTO restaurant_settings (id, settings) VALUES (1, '{"taxRate":5}'::json)`);
  await q(`DELETE FROM change_log`);

  const app = express();
  app.use("/api/sync", (req, res, next) =>
    req.headers.authorization === `Bearer ${TOKEN}` ? next() : res.status(401).json({ message: "bad device token" }));
  app.get("/api/sync/snapshot", async (_req, res) => {
    const tables: Record<string, unknown[]> = {};
    for (const t of SYNC_TABLES) tables[t] = (await q(snapshotSelectSql(t))).map((r) => r.j);
    res.json({ cursor: "0:0:", tables });
  });
  app.get("/api/sync/pull", (_req, res) => res.json({ cursor: "0:0:", changes: [] }));
  app.all("/api/*", (_req, res) => res.status(401).json({ message: "stub cloud: not signed in" }));
  app.listen(port, "127.0.0.1", () => console.log(`[stub-cloud] http://127.0.0.1:${port} (token aaaa...)`));
}
main().catch((e) => { console.error(e); process.exit(1); });
