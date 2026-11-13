// PGlite + stub-cloud proof of the shop PC's sync worker and cloud proxy (phase 3, Task B).
// The "cloud" is a tiny express app on 127.0.0.1 backed by an in-memory PGlite that serves the real
// snapshot SQL; the "local server" is a mini express app (session + passport + the same gate rules
// as server/local/bootstrap.ts). Never touches a real cloud, Supabase, or .env.
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import passport from "passport";
import { PGlite } from "@electric-sql/pglite";
import { schemaStatements } from "./lib/pgliteSchema";
import { migrationStatements, snapshotSelectSql, fetchRowsSql } from "../server/sync/changeLogSql";
import { SYNC_TABLES } from "../shared/syncTables";
import { ensureLocalSchema } from "../server/local/localSchema";
import { createSyncWorker } from "../server/local/syncWorker";
import { createCloudProxy, mergeSetCookies, cookieHeader } from "../server/local/cloudProxy";
import { isLocalRead, isLocalOnly } from "../server/local/localReadGate";
import { PgliteSessionStore } from "../server/local/sessionStore";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function listen(app: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}
const TOKEN = "t".repeat(64);

async function main() {
  // ───────────────────────── stub cloud ─────────────────────────
  const cloudDb = new PGlite();
  await cloudDb.waitReady;
  for (const s of await schemaStatements()) await cloudDb.exec(s);
  for (const s of migrationStatements()) await cloudDb.exec(s);
  const cq = async (sql: string, params: any[] = []) => (await cloudDb.query<any>(sql, params)).rows;
  await cq(`INSERT INTO users (username, password, role, pin) VALUES ('boss','scrypt','admin','1111')`);
  await cq(`INSERT INTO staff_members (name, pin, designation) VALUES ('Ravi','4321','Cook')`);
  await cq(`INSERT INTO categories (name) VALUES ('Pizza')`);
  await cq(`INSERT INTO restaurant_settings (id, settings) VALUES (1, '{"taxRate":5}'::json)`);
  await cq(`DELETE FROM change_log`);

  let version = 0;
  const feed: Array<{ v: number; table: string; id: number }> = [];
  async function cloudWrite(table: string, id: number) { feed.push({ v: ++version, table, id }); }
  const seen: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const cloudBehaviour = { pullDelayMs: 0, mode: "ok" as "ok" | "reset" | "bad-cursor" | "error500" | "expired401" };
  const cloud = express();
  cloud.use((req, _res, next) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { (req as any).rawBody = body; seen.push({ method: req.method, path: req.originalUrl, headers: req.headers, body }); next(); });
  });
  const deviceAuth: express.RequestHandler = (req, res, next) =>
    req.headers.authorization === `Bearer ${TOKEN}` ? next() : res.status(401).json({ message: "bad device token" });
  cloud.get("/api/sync/snapshot", deviceAuth, async (_req, res) => {
    const tables: Record<string, unknown[]> = {};
    for (const t of SYNC_TABLES) tables[t] = (await cq(snapshotSelectSql(t))).map((r) => r.j);
    res.json({ cursor: `${version}:${version}:`, tables });
  });
  cloud.get("/api/sync/pull", deviceAuth, async (req, res) => {
    if (cloudBehaviour.mode === "error500") return res.status(500).json({ message: "boom" });
    if (cloudBehaviour.mode === "reset") { cloudBehaviour.mode = "ok"; return res.json({ reset: true }); }
    if (cloudBehaviour.mode === "bad-cursor") { cloudBehaviour.mode = "ok"; return res.status(400).json({ message: "Invalid cursor" }); }
    const since = Number(String(req.query.cursor).split(":")[0]);
    const cur = version;
    if (cloudBehaviour.pullDelayMs) await sleep(cloudBehaviour.pullDelayMs);
    const last = new Map<string, number>();
    for (const f of feed) if (f.v > since && f.v <= cur) last.set(`${f.table}:${f.id}`, f.v);
    const changes: any[] = [];
    for (const key of Array.from(last.keys())) {
      const [table, id] = key.split(":");
      const rows = await cq(fetchRowsSql(table), [[Number(id)]]);
      changes.push({ table, id: Number(id), row: rows.length ? rows[0].j : null });
    }
    res.json({ cursor: `${cur}:${cur}:`, changes });
  });
  cloud.post("/api/auth/login", (req, res) => {
    const b = JSON.parse((req as any).rawBody || "{}");
    if (b.username === "ghost") { res.setHeader("Set-Cookie", "connect.sid=ghost-sess; Path=/; HttpOnly"); return res.json({ id: 99, username: "ghost", role: "staff" }); }
    if (b.username !== "boss" || b.password !== "pw") return res.status(401).json({ message: "Invalid username or password" });
    res.setHeader("Set-Cookie", ["connect.sid=cloud-sess-1; Path=/; HttpOnly; SameSite=None; Secure", "other=1; Path=/"]);
    res.json({ id: 1, username: "boss", role: "admin" });
  });
  cloud.post("/api/auth/card-login", (req, res) => {
    res.setHeader("Set-Cookie", "connect.sid=cloud-sess-2; Path=/; HttpOnly");
    res.json({ id: 1, username: "Ravi", role: "staff" });
  });
  cloud.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", "connect.sid=; Path=/; Max-Age=0");
    res.json({ success: true });
  });
  cloud.post("/api/orders", async (req, res) => {
    if (cloudBehaviour.mode === "expired401") return res.status(401).json({ message: "Unauthorized" });
    if (!String(req.headers.cookie ?? "").includes("connect.sid=cloud-sess-1")) return res.status(401).json({ message: "Unauthorized" });
    const b = JSON.parse((req as any).rawBody || "{}");
    const [row] = await cq(
      `INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status, notes) VALUES ($1,'takeaway','10','0','pending','pending',$2) RETURNING id`,
      [b.orderNumber ?? "ZZTEST-1", b.notes ?? null]);
    await cloudWrite("orders", row.id);
    res.status(201).setHeader("Idempotent-Replayed", "false");
    res.json({ id: row.id, echoedKey: req.headers["idempotency-key"] ?? null });
  });
  cloud.get("/api/reports/sales", (req, res) => res.json({ sales: 123, cookie: req.headers.cookie ?? null }));
  const cloudSrv = await listen(cloud);

  // ───────────────────────── worker ─────────────────────────
  const local = new PGlite();
  await local.waitReady;
  await ensureLocalSchema(local);
  const lq = async (sql: string, params: any[] = []) => (await local.query<any>(sql, params)).rows;
  const applied: string[][] = [];
  const worker = createSyncWorker({
    client: local, cloudUrl: cloudSrv.url, deviceToken: TOKEN, pullIntervalMs: 150, requestTimeoutMs: 2000, snapshotTimeoutMs: 5000,
    onApplied: (t) => { applied.push(t); }, log: () => {},
  });
  check("before start: no snapshot, no coverage", !worker.status().hasSnapshot && worker.coverageStart() === null);
  await worker.start();
  check("start() takes the first snapshot", worker.status().hasSnapshot && worker.status().online && (await lq(`SELECT count(*)::int AS n FROM users`))[0].n === 1);
  check("snapshot strips secrets (users.pin NULL, password '')", (await lq(`SELECT pin, password FROM users`))[0].pin === null && (await lq(`SELECT password FROM users`))[0].password === "");
  check("onApplied saw all synced tables after the snapshot", applied[0]?.length === SYNC_TABLES.length);
  const cov = worker.coverageStart();
  check("coverageStart is ~3 days back", !!cov && Date.now() - cov.getTime() > 2.9 * 86400_000 && Date.now() - cov.getTime() < 3 * 86400_000);

  // a cloud-side write arrives by the timer alone
  const [{ id: o1 }] = await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status) VALUES ('ZZTEST-A','takeaway','5','0','pending','pending') RETURNING id`);
  await cloudWrite("orders", o1);
  await sleep(500);
  check("the 150 ms timer pulls a cloud change by itself", (await lq(`SELECT 1 FROM orders WHERE id=$1`, [o1])).length === 1);

  // pullNow only counts a pull that STARTED after the call
  cloudBehaviour.pullDelayMs = 300;
  const slowStart = worker.pullNow(5000); // triggers a cycle that will take ~300 ms
  await sleep(60);                         // that cycle is now in flight and has already fixed its `cur`
  const [{ id: o2 }] = await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status) VALUES ('ZZTEST-B','takeaway','6','0','pending','pending') RETURNING id`);
  await cloudWrite("orders", o2);
  await worker.pullNow(5000);              // must wait for the NEXT cycle
  check("pullNow waits for a cycle that started after the call (not the in-flight one)", (await lq(`SELECT 1 FROM orders WHERE id=$1`, [o2])).length === 1);
  await slowStart;
  cloudBehaviour.pullDelayMs = 0;

  // pullNow times out without rejecting
  cloudBehaviour.pullDelayMs = 400;
  const t0 = Date.now();
  await worker.pullNow(100);
  check("pullNow(100) returns after ~100 ms even though the pull is slower", Date.now() - t0 < 350);
  cloudBehaviour.pullDelayMs = 0;
  await sleep(500);

  // reset and bad cursor both re-snapshot
  const [{ id: o3 }] = await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status) VALUES ('ZZTEST-C','takeaway','7','0','pending','pending') RETURNING id`);
  cloudBehaviour.mode = "reset";
  await worker.pullNow(3000);
  check("{reset:true} triggers a fresh snapshot (row without a change entry appears)", (await lq(`SELECT 1 FROM orders WHERE id=$1`, [o3])).length === 1);
  const [{ id: o4 }] = await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status) VALUES ('ZZTEST-D','takeaway','8','0','pending','pending') RETURNING id`);
  cloudBehaviour.mode = "bad-cursor";
  await worker.pullNow(3000);
  check("a 400 (unreadable cursor) triggers a fresh snapshot", (await lq(`SELECT 1 FROM orders WHERE id=$1`, [o4])).length === 1);

  // errors never reject; recover afterwards
  cloudBehaviour.mode = "error500";
  await worker.pullNow(3000);
  check("a failing cloud sets lastError / online=false and pullNow still resolves", !worker.status().online && /500/.test(worker.status().lastError ?? ""), String(worker.status().lastError));
  cloudBehaviour.mode = "ok";
  await worker.pullNow(3000);
  check("recovers on the next pull", worker.status().online && worker.status().lastError === null);

  // ───────────────────────── local server (mini) ─────────────────────────
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await local.query(`SELECT 1`);
  app.use(session({ secret: "test", resave: false, saveUninitialized: false, store: new PgliteSessionStore(local), cookie: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 86400000 } }));
  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((u: any, done) => done(null, u._isStaffMember ? `sm:${u.id}` : u.id));
  passport.deserializeUser(async (k: any, done) => {
    try {
      if (typeof k === "string" && k.startsWith("sm:")) {
        const r = await lq(`SELECT id, name FROM staff_members WHERE id=$1`, [Number(k.slice(3))]);
        return done(null, r.length ? { id: r[0].id, username: r[0].name, role: "staff", _isStaffMember: true } : false);
      }
      const r = await lq(`SELECT id, username, role, password FROM users WHERE id=$1`, [Number(k)]);
      done(null, r.length ? r[0] : false);
    } catch (e) { done(e); }
  });
  const proxy = createCloudProxy({
    cloudUrl: cloudSrv.url, worker, log: () => {},
    loadPrincipal: async (kind, id) => {
      if (kind === "user") { const r = await lq(`SELECT id, username, role FROM users WHERE id=$1`, [id]); return r[0] ?? null; }
      const r = await lq(`SELECT id, name FROM staff_members WHERE id=$1`, [id]);
      return r.length ? { id: r[0].id, username: r[0].name, role: "staff", _isStaffMember: true } : null;
    },
  });
  app.use("/api", (req, res, next) => {
    const path = req.originalUrl.split("?")[0];
    if (isLocalOnly(path) || isLocalRead(req.method, path, req.query as any, worker.coverageStart())) return next();
    return proxy(req, res, next);
  });
  app.get("/api/auth/me", (req, res) => res.json(req.isAuthenticated() ? { id: (req.user as any).id, username: (req.user as any).username } : null));
  app.get("/api/orders", async (req, res) => res.json(await lq(`SELECT id, order_number, notes FROM orders ORDER BY id`)));
  const localSrv = await listen(app);

  // a tiny cookie-keeping browser
  let browser = "";
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(localSrv.url + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(browser ? { cookie: browser } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = (res.headers as any).getSetCookie() as string[];
    const jar = mergeSetCookies(Object.fromEntries(browser.split("; ").filter(Boolean).map((p) => p.split("=") as [string, string])), sc);
    browser = cookieHeader(jar) ?? "";
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, json, text, setCookie: sc, headers: res.headers };
  }

  // unauthenticated write -> the cloud's own 401 passes straight through
  const r401 = await call("POST", "/api/orders", { orderNumber: "ZZTEST-X" });
  check("an unauthenticated forwarded write returns the cloud's 401 untouched", r401.status === 401 && r401.json?.message === "Unauthorized");

  // login
  seen.length = 0;
  const bad = await call("POST", "/api/auth/login", { username: "boss", password: "nope" });
  check("wrong password: cloud 401 passes through, no local login", bad.status === 401 && (await call("GET", "/api/auth/me")).json === null);
  const li = await call("POST", "/api/auth/login", { username: "boss", password: "pw" }, { origin: "http://evil.example", "x-requested-with": "fetch", "x-secret-extra": "zzz" });
  const loginSeen = seen.find((s) => s.path === "/api/auth/login" && s.body.includes("pw"))!;
  check("login passes through (200 + cloud body)", li.status === 200 && li.json?.username === "boss");
  check("the browser never receives the cloud's cookies", !li.setCookie.some((c) => /cloud-sess|other=1/.test(c)) && !browser.includes("cloud-sess"));
  check("only allow-listed headers are forwarded (no origin / host-cookie / extras)", !loginSeen.headers.origin && !loginSeen.headers["x-secret-extra"] && loginSeen.headers["x-requested-with"] === "fetch" && loginSeen.headers["content-type"] === "application/json" && !String(loginSeen.headers.cookie ?? "").includes("connect.sid="), JSON.stringify(loginSeen.headers));
  check("body forwarded intact", JSON.parse(loginSeen.body).password === "pw");
  const me = await call("GET", "/api/auth/me");
  check("cloud login also signs in locally (principal from the synced users row)", me.json?.username === "boss");
  const sessRows = await lq(`SELECT sess FROM local_sessions`);
  check("local_sessions holds the session incl. the cloud cookie jar", sessRows.some((r) => r.sess?.cloudCookies?.["connect.sid"] === "cloud-sess-1"));

  // forwarded write + read-your-writes
  seen.length = 0;
  const wr = await call("POST", "/api/orders", { orderNumber: "ZZTEST-W", notes: "from shop pc" }, { "idempotency-key": "k-123" });
  const writeSeen = seen.find((s) => s.path === "/api/orders")!;
  check("write forwarded with the cloud cookie and idempotency key", wr.status === 201 && wr.json?.echoedKey === "k-123" && String(writeSeen.headers.cookie).includes("connect.sid=cloud-sess-1"));
  check("cloud response headers pass (Idempotent-Replayed)", wr.headers.get("idempotent-replayed") === "false");
  const list = await call("GET", "/api/orders?open=true");
  check("read-your-writes: the new order is in the LOCAL copy the moment the write returns", list.json?.some((o: any) => o.id === wr.json.id && o.notes === "from shop pc"), JSON.stringify(list.json));

  // unlisted GET proxies with the cloud cookie
  const rep = await call("GET", "/api/reports/sales");
  check("an unlisted GET proxies, carrying the cloud cookie", rep.json?.sales === 123 && String(rep.json?.cookie).includes("cloud-sess-1"));

  // cloud session expired while the local one is alive
  cloudBehaviour.mode = "expired401";
  const exp = await call("POST", "/api/orders", { orderNumber: "ZZTEST-E" });
  cloudBehaviour.mode = "ok";
  check("a cloud 401 for a locally signed-in user also signs them out locally", exp.status === 401 && (await call("GET", "/api/auth/me")).json === null);

  // card login (staff) + logout
  const cl = await call("POST", "/api/auth/card-login", { kind: "staff", id: 1, pin: "4321" });
  check("card-login (staff) signs in locally as the staff principal", cl.status === 200 && (await call("GET", "/api/auth/me")).json?.username === "Ravi");
  seen.length = 0;
  const lo = await call("POST", "/api/auth/logout", {});
  check("logout is forwarded and signs out locally", lo.status === 200 && (await call("GET", "/api/auth/me")).json === null);
  const logoutSeen = seen.find((x) => x.path === "/api/auth/logout");
  check("logout to the cloud carries the old cookie", !!logoutSeen && String(logoutSeen.headers.cookie).includes("connect.sid=cloud-sess-2"));

  // not-yet-synced principal
  const gh = await call("POST", "/api/auth/login", { username: "ghost", password: "x" });
  check("cloud login for a person missing from the local copy -> 503 LOCAL_NOT_SYNCED (no half login)", gh.status === 503 && gh.json?.code === "LOCAL_NOT_SYNCED" && (await call("GET", "/api/auth/me")).json === null);

  // restart survives: a new store instance over the same DB still has the session
  await call("POST", "/api/auth/login", { username: "boss", password: "pw" });
  const store2 = new PgliteSessionStore(local);
  const sid = (await lq(`SELECT sid FROM local_sessions WHERE sess->'passport' IS NOT NULL LIMIT 1`))[0]?.sid;
  const got: any = await new Promise((resolve) => store2.get(sid, (_e, s) => resolve(s)));
  check("sessions survive in PGlite (a fresh store reads the signed-in session)", got?.passport?.user === 1);

  // cloud down: logout still signs out locally and answers 200
  check("signed in again before the cloud-down logout test", (await call("GET", "/api/auth/me")).json?.username === "boss");
  const proxyDown = createCloudProxy({
    cloudUrl: "http://127.0.0.1:1", worker, log: () => {}, timeoutMs: 1000,
    loadPrincipal: async () => null,
  });
  const downApp = express();
  downApp.use(session({ secret: "test", resave: false, saveUninitialized: false, store: new PgliteSessionStore(local), cookie: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 86400000 } }));
  downApp.use(passport.initialize());
  downApp.use(passport.session());
  downApp.get("/api/auth/me", (req, res) => res.json(req.isAuthenticated() ? { id: (req.user as any).id } : null));
  downApp.use("/api", (req, res, next) => proxyDown(req, res, next));
  const downSrv = await listen(downApp);
  const signedIn = await fetch(localSrv.url + "/api/auth/me", { headers: { cookie: browser } }).then((r) => r.json());
  const loDown = await fetch(downSrv.url + "/api/auth/logout", { method: "POST", headers: { "content-type": "application/json", cookie: browser }, body: "{}" });
  const loDownJson: any = await loDown.json().catch(() => null);
  const afterCookie = (loDown.headers as any).getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
  const meAfter = await fetch(downSrv.url + "/api/auth/me", { headers: { cookie: afterCookie || browser } }).then((r) => r.json());
  check("logout with the cloud unreachable answers 200 {success:true}", signedIn?.username === "boss" && loDown.status === 200 && loDownJson?.success === true, `${loDown.status} ${JSON.stringify(loDownJson)}`);
  check("...and /api/auth/me is null afterwards", meAfter === null, JSON.stringify(meAfter) + " cookie=" + afterCookie);
  const sidRow = (await lq(`SELECT count(*)::int AS n FROM local_sessions WHERE sess->'passport'->>'user' = '1'`))[0].n;
  check("...the local session no longer holds the user", sidRow === 0, `rows=${sidRow}`);
  downSrv.server.close();
  (downSrv.server as any).closeAllConnections?.();

  // cloud down
  await new Promise<void>((r) => cloudSrv.server.close(() => r()));
  (cloudSrv.server as any).closeAllConnections?.();
  const down = await call("POST", "/api/orders", { orderNumber: "ZZTEST-D" });
  check("cloud unreachable -> 502 CLOUD_UNREACHABLE", down.status === 502 && down.json?.code === "CLOUD_UNREACHABLE" && down.json?.error === "Cloud unreachable", JSON.stringify(down.json));
  check("local reads keep working with the cloud down", (await call("GET", "/api/orders?open=true")).status === 200);
  await worker.pullNow(500);
  check("worker reports offline", !worker.status().online);

  worker.stop();
  localSrv.server.close();
  (localSrv.server as any).closeAllConnections?.();
  console.log(failures === 0 ? "\nAll local-sync checks passed" : `\n${failures} local-sync check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
