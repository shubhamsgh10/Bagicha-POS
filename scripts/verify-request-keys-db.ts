/**
 * Manual, touches the shared DB — ONLY the request_keys table, rows keyed "zztest-…", deleted at the end.
 * Runs the real server/requestKeys.ts middleware on a throwaway in-process Express app (no orders,
 * no printing, no realtime). Needs the migration first: node scripts/migrate-request-keys.mjs
 * Run: npx tsx -r dotenv/config scripts/verify-request-keys-db.ts
 */
import express from "express";
import type { AddressInfo } from "net";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { requestKeys } from "../server/requestKeys";

const prefix = `zztest-${Date.now().toString(36)}-`;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).user = { id: Number(req.get("x-test-user") ?? 990001), username: "zztest", role: "staff" };
  next();
});
let runs = 0;
app.post("/api/zz-keyed", requestKeys, async (req, res) => {
  runs++;
  const run = runs;
  await new Promise((r) => setTimeout(r, Number(req.body?.delayMs ?? 0)));
  res.status(Number(req.body?.status ?? 200)).json({ run, echo: req.body?.echo ?? null });
});

const checks: Array<[string, boolean]> = [];

async function main() {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (body: unknown, key?: string, user?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key !== undefined) headers["Idempotency-Key"] = key;
    if (user !== undefined) headers["x-test-user"] = String(user);
    const r = await fetch(`${base}/api/zz-keyed`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: r.status, replayed: r.headers.get("idempotent-replayed") === "true", body: await r.json() as any };
  };

  try {
    let before = runs;
    await post({ echo: "a" }); await post({ echo: "a" });
    checks.push(["no key: runs every time (unchanged)", runs - before === 2]);

    before = runs;
    const k1 = `${prefix}seq`;
    const s1 = await post({ echo: "x" }, k1);
    const s2 = await post({ echo: "x" }, k1);
    checks.push(["same key twice: route ran once", runs - before === 1]);
    checks.push(["…the repeat is a replay with the same answer", s2.replayed && !s1.replayed && s2.body.run === s1.body.run && s2.status === 200]);

    before = runs;
    const k2 = `${prefix}conc`;
    const [c1, c2] = await Promise.all([post({ echo: "c", delayMs: 600 }, k2), post({ echo: "c", delayMs: 600 }, k2)]);
    checks.push(["same key at the same time: route ran once", runs - before === 1]);
    checks.push(["…both got the same answer, exactly one replayed", c1.body.run === c2.body.run && (c1.replayed !== c2.replayed)]);

    const m1 = await post({ echo: "DIFFERENT" }, k1);
    checks.push(["same key, different body → 422 mismatch", m1.status === 422 && m1.body.code === "idempotency_key_mismatch"]);
    const m2 = await post({ echo: "x" }, k1, 990002);
    checks.push(["same key, different user → 422 mismatch", m2.status === 422]);

    const bad = await post({ echo: "x" }, "bad key!");
    checks.push(["malformed key → 400", bad.status === 400 && bad.body.code === "bad_idempotency_key"]);

    before = runs;
    const k3 = `${prefix}err`;
    const e1 = await post({ status: 500, echo: "e" }, k3);
    const e2 = await post({ status: 500, echo: "e" }, k3);
    checks.push(["a stored error is replayed, never re-run", e1.status === 500 && e2.status === 500 && e2.replayed && runs - before === 1]);

    const k4 = `${prefix}slow`;
    const first = post({ echo: "s", delayMs: 9500 }, k4);
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    const second = await post({ echo: "s", delayMs: 9500 }, k4);
    const waited = Date.now() - t0;
    checks.push(["repeat while the first still runs past 8 s → 409 request_in_progress", second.status === 409 && second.body.code === "request_in_progress"]);
    checks.push(["…after waiting about 8 s", waited >= 7500 && waited < 9500]);
    checks.push(["…and the first still completes", (await first).status === 200]);

    const rls = await db.execute(sql`select relrowsecurity as rls from pg_class where relname = 'request_keys' and relnamespace = 'public'::regnamespace`);
    checks.push(["request_keys has row-level security on", (rls as any).rows?.[0]?.rls === true]);
  } finally {
    await db.execute(sql`delete from request_keys where key like ${prefix + "%"}`);
    const left = await db.execute(sql`select count(*)::int as n from request_keys where key like ${prefix + "%"}`);
    checks.push(["cleanup: no zztest rows left", Number((left as any).rows?.[0]?.n) === 0]);
    server.close();
  }

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
