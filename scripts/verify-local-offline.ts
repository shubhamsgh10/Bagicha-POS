// Phase 4B end-to-end proof, in one process: the REAL local server (server/routes.ts + server/local/*
// on a PGlite directory) against a stub cloud on 127.0.0.1 (an in-memory PGlite behind a tiny express
// app that speaks the real sync SQL). Never touches a real cloud, Supabase or .env.
//
// Covers: create -> KOT -> settle offline then replay in order with the right headers / client ids
// and the acknowledgement refresh replacing temp ids; conflict -> problems (+ later same-order
// entries, other orders keep flowing); lease use and exhaustion; offline login / PIN against
// local_auth with the online limits; ONLINE_ONLY when offline; pulls skip orders with pending entries;
// an outbox/lease-preserving schema rebuild rule.
process.env.BAGICHA_LOCAL_MODE = "1";
process.env.BAGICHA_DB = "pglite";
process.env.SESSION_SECRET = "test-secret-for-local-offline";
delete process.env.DATABASE_URL;
delete process.env.BACKGROUND_JOBS;

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import passport from "passport";
import { PGlite } from "@electric-sql/pglite";
import { schemaStatements } from "./lib/pgliteSchema";
import { snapshotPageSql, rowJsonSql, fetchRowsSql } from "../server/sync/changeLogSql";
import { SYNC_TABLES_V2 } from "../shared/syncTables";
import { attachAuth } from "../server/sync/authBlob";
import { hashPassword } from "../server/passwordHash";
import { baseMatches } from "../shared/replayRules";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean> | boolean, ms = 8000, step = 60): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return !!(await fn());
}
const TOKEN = "d".repeat(64);

async function main() {
  // ───────────────────────── stub cloud ─────────────────────────
  const cdb = new PGlite();
  await cdb.waitReady;
  for (const s of await schemaStatements()) await cdb.exec(s);
  const cq = async (sql: string, params: any[] = []) => (await cdb.query<any>(sql, params)).rows;
  const runner = { query: async (sql: string, params?: unknown[]) => ({ rows: (await cdb.query<any>(sql, params as any[])).rows }) };
  const ownerPw = await hashPassword("ownerpw");
  const mgrPw = await hashPassword("mgrpw");
  await cq(`INSERT INTO users (id, username, password, role, pin) VALUES (1,'owner',$1,'admin','1111'),(2,'mgr',$2,'manager','2222')`, [ownerPw, mgrPw]);
  await cq(`INSERT INTO staff_members (id, name, pin, designation, show_on_mobile, is_active) VALUES (7,'Sam','3333','Service',true,true)`);
  await cq(`INSERT INTO categories (id, name) VALUES (1,'Pizza')`);
  await cq(`INSERT INTO menu_items (id, name, price, category_id) VALUES (1,'Margherita','100',1)`);
  await cq(`INSERT INTO tables (id, name, status) VALUES (1,'T1','free'),(2,'T2','free')`);
  await cq(`INSERT INTO restaurant_settings (id, settings) VALUES (1, '{"taxRate":5,"billCounter":99,"kotCounter":199}'::json)`);

  let version = 0;
  const feed: Array<{ v: number; table: string; id: number }> = [];
  const wrote = (table: string, id: number) => feed.push({ v: ++version, table, id });
  const ctl = { down: false, hold: false, conflict: new Set<string>(), refuse: new Set<string>(), leaseSize: 3, nextOrderId: 9000, nextBill: 100, nextKot: 200 };
  const replays: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const cloud = express();
  cloud.use((req, res, next) => {
    if (ctl.down) { req.socket.destroy(); return; }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { (req as any).body = raw ? JSON.parse(raw) : {}; next(); });
  });
  const deviceAuth: express.RequestHandler = (req, res, next) =>
    req.headers.authorization === `Bearer ${TOKEN}` ? next() : res.status(401).json({ message: "Invalid or revoked device token" });
  cloud.get("/api/sync/snapshot", deviceAuth, async (req, res) => {
    if (req.query.begin === "1") return res.json({ cursor: `${version}:${version}:`, tables: Array.from(SYNC_TABLES_V2), pageSize: 1000 });
    const table = String(req.query.table);
    const limit = Number(req.query.limit ?? 1000);
    const got = await cq(snapshotPageSql(table), [req.query.after ? String(req.query.after) : null, limit]);
    const rows = got.map((r) => r.j);
    await attachAuth(runner, table, rows);
    res.json({ table, rows, next: got.length === limit ? String(got[got.length - 1].id) : null });
  });
  cloud.get("/api/sync/pull", deviceAuth, async (req, res) => {
    const since = Number(String(req.query.cursor).split(":")[0]);
    const cur = version;
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
  cloud.post("/api/sync/lease", deviceAuth, (req, res) => {
    const kind = req.body.kind as string;
    const size = ctl.leaseSize;
    let start: number;
    if (kind === "order_id") { start = ctl.nextOrderId; ctl.nextOrderId += size; }
    else if (kind === "bill_counter") { start = ctl.nextBill; ctl.nextBill += size; }
    else { start = ctl.nextKot; ctl.nextKot += size; }
    res.json({ kind, start, end: start + size - 1 });
  });
  cloud.get("/api/sync/order/:id", deviceAuth, async (req, res) => {
    const id = Number(req.params.id);
    const o = (await cq(`SELECT ${rowJsonSql("orders")} AS j FROM orders t WHERE t.id = $1`, [id]))[0]?.j;
    if (!o) return res.json({ deleted: true });
    const items = (await cq(`SELECT ${rowJsonSql("order_items")} AS j FROM order_items t WHERE t.order_id = $1 ORDER BY t.id`, [id])).map((r) => r.j);
    const kotTickets = (await cq(`SELECT ${rowJsonSql("kot_tickets")} AS j FROM kot_tickets t WHERE t.order_id = $1 ORDER BY t.id`, [id])).map((r) => r.j);
    res.json({ order: o, items, kotTickets });
  });
  cloud.post("/api/auth/login", (req, res) => {
    if (req.body.username === "owner" && req.body.password === "ownerpw") {
      res.setHeader("Set-Cookie", "connect.sid=cloud-1; Path=/; HttpOnly");
      return res.json({ id: 1, username: "owner", role: "admin" });
    }
    if (req.body.username === "mgr" && req.body.password === "mgrpw") {
      res.setHeader("Set-Cookie", "connect.sid=cloud-2; Path=/; HttpOnly");
      return res.json({ id: 2, username: "mgr", role: "manager" });
    }
    res.status(401).json({ message: "Invalid username or password" });
  });
  cloud.post("/api/auth/card-login", (req, res) => {
    if (req.body.kind === "staff" && Number(req.body.id) === 7 && req.body.pin === "3333") {
      res.setHeader("Set-Cookie", "connect.sid=cloud-3; Path=/; HttpOnly");
      return res.json({ id: 7, username: "Sam", role: "staff" });
    }
    res.status(401).json({ message: "Wrong PIN" });
  });
  cloud.post("/api/auth/verify-pin", (_req, res) => res.json({ valid: true }));
  cloud.get("/api/crm/segments", (_req, res) => res.json({ segments: 1 }));
  // The replay endpoint: behaves like the cloud routes closely enough for the PC's rules.
  cloud.all("/api/*", async (req, res) => {
    if (req.headers["x-bagicha-replay"] !== "1") return res.status(404).json({ message: "stub: not found" });
    replays.push({ method: req.method, path: req.originalUrl, headers: req.headers, body: req.body });
    if (ctl.hold) return res.status(503).json({ message: "cloud busy" });
    const m = /^\/api\/orders\/(\d+)/.exec(req.originalUrl);
    const oid = m ? Number(m[1]) : (req.originalUrl === "/api/print/kot" || req.originalUrl === "/api/print/bill" ? Number(req.body.orderId) : null);
    if (oid !== null) {
      const cur = (await cq(`SELECT to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS.US') AS u FROM orders WHERE id=$1`, [oid]))[0]?.u ?? null;
      if (cur === null) return res.status(404).json({ error: "Order not found" });
      const base = req.headers["x-replay-base"];
      if (typeof base === "string" && !baseMatches(cur, base)) return res.status(409).json({ error: "changed in the cloud", code: "conflict" });
      if (ctl.refuse.has(`${req.method} ${req.originalUrl}`)) return res.status(422).json({ error: "refused", code: "bad_thing" });
      if (ctl.conflict.has(`${req.method} ${req.originalUrl}`)) return res.status(409).json({ error: "forced conflict", code: "conflict" });
    }
    if (req.method === "POST" && req.originalUrl === "/api/orders") {
      const b = req.body;
      const id = Number(b.clientId);
      await cq(`INSERT INTO orders (id, order_number, order_type, table_id, total_amount, tax_amount, status, payment_status) VALUES ($1,$2,$3,$4,'210','10','pending','pending')`,
        [id, b.clientOrderNumber, b.orderType ?? "dine-in", b.tableId ?? null]);
      for (const it of b.items ?? []) {
        const r = await cq(`INSERT INTO order_items (order_id, menu_item_id, quantity, price, name) VALUES ($1,$2,$3,$4,'Margherita') RETURNING id`, [id, it.menuItemId, it.quantity, it.price ?? "100"]);
        wrote("order_items", r[0].id);
      }
      if (b.clientKotNumber) {
        const r = await cq(`INSERT INTO kot_tickets (order_id, kot_number, items) VALUES ($1,$2,'[]'::json) RETURNING id`, [id, b.clientKotNumber]);
        wrote("kot_tickets", r[0].id);
      }
      wrote("orders", id);
      return res.status(200).json({ id });
    }
    if (oid !== null) {
      if (req.method === "POST" && /\/payment$/.test(req.originalUrl)) await cq(`UPDATE orders SET payment_status='paid', status='served', updated_at=now() WHERE id=$1`, [oid]);
      else if (req.method === "PUT" && /\/cancel$/.test(req.originalUrl)) await cq(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [oid]);
      else await cq(`UPDATE orders SET updated_at=now() WHERE id=$1`, [oid]);
      wrote("orders", oid);
    }
    res.status(200).json({ ok: true });
  });
  const cloudSrv: http.Server = await new Promise((r) => { const s = http.createServer(cloud).listen(0, "127.0.0.1", () => r(s)); });
  const cloudUrl = `http://127.0.0.1:${(cloudSrv.address() as AddressInfo).port}`;

  // ───────────────────────── the real local server ─────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bagicha-local-offline-"));
  process.env.BAGICHA_PGLITE_DIR = dir;
  process.env.BAGICHA_CLOUD_URL = cloudUrl;
  process.env.BAGICHA_DEVICE_TOKEN = TOKEN;

  const { PgliteSessionStore } = await import("../server/local/sessionStore");
  const { localClient } = await import("../server/db");
  const { requireAuth, registerRoutes } = await import("../server/routes");
  const { settingsGuard } = await import("../server/settingsStore");
  const local = await import("../server/local/bootstrap");
  const lq = async (sql: string, params: any[] = []) => (await localClient!.query<any>(sql, params)).rows;

  const app = express();
  app.use(express.json());
  const sessionMiddleware = session({
    secret: "x", resave: false, saveUninitialized: false, store: new PgliteSessionStore(localClient!),
    cookie: { httpOnly: true, secure: false, sameSite: "lax" },
  });
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());
  const origError = console.error;
  const runtime = await local.bootLocalMode();
  await local.installLocalGate(app, runtime, requireAuth);
  app.use("/api", settingsGuard);
  const server = await registerRoutes(app, sessionMiddleware);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // tiny client with a cookie jar per "person"
  class Client {
    cookie = "";
    async call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
      const res = await fetch(base + p, {
        method, headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const sc = (res.headers as any).getSetCookie?.() as string[] | undefined;
      if (sc?.length) this.cookie = sc.map((c) => c.split(";")[0]).join("; ");
      let json: any = null;
      try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json };
    }
  }
  const status = async () => (await new Client().call("GET", "/api/local/status")).json;
  const goOffline = async () => {
    ctl.down = true;
    await new Client().call("POST", "/api/local/sync-now"); // unauthenticated: 401, so poke the worker directly
    runtime.worker.requestPull();
    await until(async () => runtime.worker.status().online === false, 12000);
  };
  const goOnline = async () => {
    ctl.down = false;
    runtime.worker.requestPull();
    await until(async () => runtime.worker.status().online === true, 12000);
  };

  // ── boot ──
  check("first snapshot (protocol v2, paged) applied: users, staff, menu in the local copy",
    (await lq(`SELECT count(*)::int AS n FROM users`))[0].n === 2 && (await lq(`SELECT count(*)::int AS n FROM menu_items`))[0].n === 1);
  const auth = await lq(`SELECT kind, id, pw, pin FROM local_auth ORDER BY kind, id`);
  check("local_auth filled from _auth for 2 users + 1 staff member", auth.length === 3);
  check("local_auth holds only scrypt salt:hash verifiers, never a plaintext PIN",
    auth.every((a) => (!a.pin || /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(a.pin)) && a.pin !== "1111" && a.pin !== "2222" && a.pin !== "3333"));
  check("users.pin / users.password are NOT stored in the synced tables",
    (await lq(`SELECT pin, password FROM users ORDER BY id`)).every((u) => u.pin === null && u.password === ""));
  const seq = await lq(`SELECT last_value::text AS v FROM order_items_id_seq`);
  check("order_items ids start at 1,000,000,000 for rows created on this PC", Number(seq[0].v) >= 999_999_999);
  check("leases for all three kinds were fetched after the first cycle",
    await until(async () => (await lq(`SELECT DISTINCT kind FROM local_leases`)).length === 3));

  // ── online sign-in goes through the cloud ──
  const owner = new Client();
  let r = await owner.call("POST", "/api/auth/login", { username: "owner", password: "ownerpw" });
  check("online login: the cloud decides, the local session is created", r.status === 200 && r.json?.username === "owner" && (await owner.call("GET", "/api/auth/me")).json?.id === 1);
  r = await new Client().call("POST", "/api/auth/login", { username: "owner", password: "wrong" });
  check("online wrong password is refused by the cloud", r.status === 401);

  // ── go offline ──
  await goOffline();
  check("the worker notices the cloud is gone (status online:false)", (await status()).online === false);

  // offline login: users and PIN cards
  const mgr = new Client();
  r = await mgr.call("POST", "/api/auth/login", { username: "mgr", password: "mgrpw" });
  check("OFFLINE login verifies the scrypt hash from local_auth", r.status === 200 && r.json?.username === "mgr" && r.json?.password === undefined && r.json?.pin === undefined);
  r = await new Client().call("POST", "/api/auth/login", { username: "mgr", password: "nope" });
  check("OFFLINE wrong password is refused", r.status === 401);
  const sam = new Client();
  r = await sam.call("POST", "/api/auth/card-login", { kind: "staff", id: 7, pin: "3333" });
  check("OFFLINE staff card login with the right PIN", r.status === 200 && r.json?.username === "Sam");
  const me = (await sam.call("GET", "/api/auth/me")).json;
  check("the staff principal has the same shape as deserializeUser's", me?.id === 7 && me?.role === "staff" && me?._isStaffMember === true);
  r = await new Client().call("POST", "/api/auth/card-login", { kind: "staff", id: 7, pin: "9999" });
  check("OFFLINE wrong card PIN is refused", r.status === 401);
  r = await new Client().call("POST", "/api/auth/card-login", { kind: "user", id: 1, pin: "1111" });
  check("an admin is never card-eligible offline either", r.status === 401);
  r = await sam.call("POST", "/api/auth/verify-pin", { pin: "2222", requiredRole: "manager" });
  check("OFFLINE verify-pin accepts a manager PIN", r.status === 200 && r.json?.valid === true);
  r = await sam.call("POST", "/api/auth/verify-pin", { pin: "2222", requiredRole: "admin" });
  check("a manager PIN does not satisfy requiredRole=admin", r.json?.valid === false);
  r = await sam.call("POST", "/api/auth/verify-pin", { pin: "1111", requiredRole: "admin" });
  check("the admin PIN satisfies requiredRole=admin", r.json?.valid === true);

  // admin-only routes stay admin-only; online-only routes say so
  r = await mgr.call("POST", "/api/orders/merge", { targetOrderId: 1, sourceOrderId: 2 });
  check("ONLINE_ONLY when offline: merge answers 503 {code, message:'Needs internet'}", r.status === 503 && r.json?.code === "ONLINE_ONLY" && r.json?.message === "Needs internet");
  r = await mgr.call("GET", "/api/crm/segments");
  check("ONLINE_ONLY when offline: cloud-only GET", r.status === 503 && r.json?.code === "ONLINE_ONLY");
  r = await mgr.call("POST", "/api/menu", { name: "x", price: "1", categoryId: 1 });
  check("menu admin write is ONLINE_ONLY offline", r.status === 503 && r.json?.code === "ONLINE_ONLY");

  // ── create -> KOT -> settle, offline ──
  const items = [{ menuItemId: 1, name: "Margherita", quantity: 2, price: "100" }];
  r = await mgr.call("POST", "/api/orders", { orderType: "dine-in", tableId: 1, items }, { "Idempotency-Key": "client-key-create-0001" });
  const orderA = r.json?.id;
  check("offline create succeeds with a LEASED id and order number", r.status === 200 && orderA === 9000 && r.json?.orderNumber === "ORD0100", JSON.stringify(r.json)?.slice(0, 160));
  check("its item and KOT ticket carry local temporary ids (>= 1e9)",
    (await lq(`SELECT id FROM order_items WHERE order_id=$1`, [orderA])).every((x) => x.id >= 1_000_000_000)
    && (await lq(`SELECT id FROM kot_tickets WHERE order_id=$1`, [orderA])).every((x) => x.id >= 1_000_000_000));
  r = await mgr.call("POST", "/api/print/kot", { orderId: orderA });
  check("KOT print runs locally offline (any non-error outcome)", r.status === 200, JSON.stringify(r.json)?.slice(0, 160));
  r = await mgr.call("POST", `/api/orders/${orderA}/payment`, { paymentMethod: "cash" });
  check("settle runs locally offline", r.status === 200 && r.json?.paymentStatus === "paid", JSON.stringify(r.json)?.slice(0, 160));
  let pend = await lq(`SELECT seq, order_id, method, path, idem_key, actor, status, numbers, base FROM local_outbox ORDER BY seq`);
  check("three entries queued in order: create, KOT, settle", pend.length === 3 && pend[0].path === "/api/orders" && pend[1].path === "/api/print/kot" && pend[2].path === `/api/orders/${orderA}/payment` && pend.every((p) => p.status === "pending"));
  check("each entry has its own key; the client's own key is reused", new Set(pend.map((p) => p.idem_key)).size === 3 && pend[0].idem_key === "client-key-create-0001");
  check("create entry records the leased numbers (id, bill no, KOT no)", pend[0].numbers?.id === 9000 && pend[0].numbers?.billNo === 100 && pend[0].numbers?.kotNos?.[0] === 200, JSON.stringify(pend[0].numbers));
  check("the order's id is on the entries (so pulls and cascades can see it)", pend.every((p) => p.order_id === orderA));
  check("the actor is recorded as u:<id>", pend.every((p) => p.actor === "u:2"));

  // lease exhaustion
  const exhaustKinds = async () => (await lq(`SELECT kind, COALESCE(sum(end_value-next_value+1),0)::int AS n FROM local_leases WHERE next_value<=end_value GROUP BY kind`));
  let guard = 0; let lastStatus = 200; let lastCode = "";
  while (guard++ < 30) {
    const x = await mgr.call("POST", "/api/orders", { orderType: "takeaway", items });
    lastStatus = x.status; lastCode = x.json?.code;
    if (x.status !== 200) break;
  }
  check("exhausted leases offline: 503 LEASE_EXHAUSTED with a clear message", lastStatus === 503 && lastCode === "LEASE_EXHAUSTED", `${lastStatus} ${lastCode} ${JSON.stringify(await exhaustKinds())}`);
  const queued = (await lq(`SELECT count(*)::int AS n FROM local_outbox`))[0].n;

  // ── reconnect: the replay ──
  // first keep the cloud "busy" so entries stay pending while a pull still works (pull-skip proof)
  ctl.hold = true;
  await goOnline();
  check("5xx from the cloud does not take the PC offline: pulls still run, the outbox stays pending",
    (await status()).online === true && (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE status='pending'`))[0].n === queued);
  const tablesBefore = (await lq(`SELECT status FROM tables WHERE id = 1`))[0];
  // a "phone" edits order A's cloud copy and the table meanwhile: nothing exists in the cloud yet, so
  // create the pending order's twin row to prove the skip rule on the local side
  await cq(`INSERT INTO orders (id, order_number, order_type, total_amount, tax_amount, status, payment_status, notes) VALUES (9000,'ORD0100','dine-in','1','0','pending','pending','phone note')`);
  wrote("orders", 9000);
  runtime.worker.requestPull();
  await sleep(500);
  await until(async () => (await status()).lastPullAt !== null);
  runtime.worker.requestPull();
  await sleep(600);
  const aLocal = (await lq(`SELECT notes, total_amount FROM orders WHERE id=9000`))[0];
  check("a pull SKIPS an order that has pending local entries (local state not overwritten)", aLocal.notes !== "phone note" && aLocal.total_amount !== "1", JSON.stringify(aLocal));
  check("the skipped table row is not touched either", (await lq(`SELECT status FROM tables WHERE id = 1`))[0].status === tablesBefore.status);
  await cq(`DELETE FROM orders WHERE id = 9000`);
  const attemptsBefore = replays.length;
  check("while the cloud is busy the replay was attempted (and refused with 503)", attemptsBefore >= 1 && replays[0].path === "/api/orders");
  const firstKey = replays[0].headers["idempotency-key"];

  ctl.hold = false;
  runtime.worker.requestPull();
  check("after the cloud recovers every entry is acknowledged (sent)", await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE status<>'sent'`))[0].n === 0, 15000), JSON.stringify(await lq(`SELECT seq,path,status,last_error FROM local_outbox WHERE status<>'sent'`)));
  const okReplays = replays.filter((x) => x.path === "/api/orders" && x.headers["idempotency-key"] === firstKey);
  check("a retry re-sends the SAME Idempotency-Key", okReplays.length >= 2);
  const create = replays.find((x) => x.method === "POST" && x.path === "/api/orders" && x.headers["idempotency-key"] === "client-key-create-0001")!;
  check("replay headers: replay flag, device token, actor, action time, key",
    create.headers["x-bagicha-replay"] === "1" && create.headers.authorization === `Bearer ${TOKEN}` && create.headers["x-replay-actor"] === "u:2"
    && !Number.isNaN(Date.parse(String(create.headers["x-replay-at"]))) && create.headers["idempotency-key"] === "client-key-create-0001");
  check("replay body carries clientId / clientOrderNumber / clientKotNumber", create.body.clientId === 9000 && create.body.clientOrderNumber === "ORD0100" && create.body.clientKotNumber === "200");
  check("the create has no base; later entries of the order carry the cloud's updated_at", create.headers["x-replay-base"] === undefined
    && replays.filter((x) => x.path === `/api/orders/${orderA}/payment`).pop()!.headers["x-replay-base"] !== undefined);
  const seqOrder = replays.filter((x) => x.headers["idempotency-key"] && x.path !== "/api/sync/order").map((x) => x.path).filter((p, i, a) => a.indexOf(p) === i);
  check("entries replayed in order: create, KOT, settle (first of each path)", seqOrder.indexOf("/api/orders") < seqOrder.indexOf("/api/print/kot") && seqOrder.indexOf("/api/print/kot") < seqOrder.indexOf(`/api/orders/${orderA}/payment`));
  check("acknowledgement refresh: temporary ids are gone, the cloud's rows replaced them",
    await until(async () => (await lq(`SELECT id FROM order_items WHERE order_id=$1`, [orderA])).every((x) => x.id < 1_000_000_000)
      && (await lq(`SELECT id FROM kot_tickets WHERE order_id=$1`, [orderA])).every((x) => x.id < 1_000_000_000)
      && (await lq(`SELECT payment_status FROM orders WHERE id=$1`, [orderA]))[0].payment_status === "paid"));

  // ── conflicts ──
  // keep the cloud busy again so a batch of entries piles up, then release it
  ctl.hold = true;
  await mgr.call("POST", "/api/sync-guard-noop").catch(() => {});
  r = await mgr.call("POST", "/api/orders", { orderType: "dine-in", tableId: 2, items }); const orderB = r.json?.id;
  r = await mgr.call("PUT", `/api/orders/${orderB}/items`, { items: [{ ...items[0], quantity: 3 }] });
  const editStatus = r.status;
  r = await mgr.call("POST", `/api/orders/${orderB}/payment`, { paymentMethod: "cash" });
  r = await mgr.call("POST", "/api/orders", { orderType: "takeaway", items }); const orderC = r.json?.id;
  check("online (cloud busy): order B create/edit/settle and order C create queued", !!orderB && !!orderC && editStatus === 200, `${orderB} ${orderC} ${editStatus}`);
  ctl.conflict.add(`PUT /api/orders/${orderB}/items`);
  ctl.hold = false;
  runtime.worker.requestPull();
  check("B's refused edit is a PROBLEM", await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE status='problem' AND order_id=$1`, [orderB]))[0].n >= 1, 15000));
  const probs = await lq(`SELECT seq, path, status, last_code FROM local_outbox WHERE order_id=$1 ORDER BY seq`, [orderB]);
  check("the problem takes every LATER entry of the same order with it (create was sent)", probs[0].status === "sent" && probs[1].status === "problem" && probs[1].last_code === "conflict" && probs[2].status === "problem", JSON.stringify(probs));
  check("another order (C) still flows past the problem", await until(async () => (await lq(`SELECT status FROM local_outbox WHERE order_id=$1 ORDER BY seq`, [orderC])).every((x) => x.status === "sent")));
  const st = await status();
  check("status reports the problem count", st.problems === 2 && st.outboxPending === 0, JSON.stringify({ p: st.problems, w: st.outboxPending }));
  check("the order was refreshed from the cloud after the problem (no temp ids left)", (await lq(`SELECT id FROM order_items WHERE order_id=$1`, [orderB])).every((x) => x.id < 1_000_000_000));

  // Sync screen endpoints: everything that changes the outbox needs manager/admin AND a PIN typed just now
  r = await new Client().call("GET", "/api/local/problems");
  check("problems list needs a login", r.status === 401);
  r = await mgr.call("GET", "/api/local/problems");
  check("the manager sees both held entries", r.status === 200 && r.json.length === 2);
  const firstProblemSeq = r.json[0].seq;
  r = await sam.call("POST", `/api/local/problems/${firstProblemSeq}/discard`, {});
  check("a staff session cannot discard", r.status === 403);
  r = await sam.call("POST", `/api/local/problems/${firstProblemSeq}/retry`, {});
  check("a staff session cannot retry", r.status === 403);
  const mgr2 = new Client();
  await mgr2.call("POST", "/api/auth/login", { username: "mgr", password: "mgrpw" });
  let noPin = await mgr2.call("POST", `/api/local/problems/${firstProblemSeq}/retry`, { override: true });
  check("RETRY without a fresh PIN is refused even for a logged-in manager (403 PIN_REQUIRED)", noPin.status === 403 && noPin.json?.code === "PIN_REQUIRED");
  noPin = await mgr2.call("POST", `/api/local/problems/${firstProblemSeq}/discard`, {});
  check("discard needs a FRESH PIN even for a logged-in manager", noPin.status === 403 && noPin.json?.code === "PIN_REQUIRED");
  await mgr2.call("POST", "/api/auth/verify-pin", { pin: "2222", requiredRole: "manager" });
  const rowBefore = (await lq(`SELECT base, override FROM local_outbox WHERE seq=$1`, [firstProblemSeq]))[0];
  r = await mgr2.call("POST", `/api/local/problems/${firstProblemSeq}/retry`, {});
  check("retry of a CONFLICT without the explicit override is refused (override_required), nothing requeued",
    r.status === 409 && r.json?.code === "override_required" && (await lq(`SELECT status FROM local_outbox WHERE seq=$1`, [firstProblemSeq]))[0].status === "problem");
  const cloudNow = (await cq(`SELECT to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS.US') AS u FROM orders WHERE id=$1`, [orderB]))[0].u;
  ctl.conflict.clear(); // the next send would succeed on its own
  const replaysBefore = replays.length;
  r = await mgr2.call("POST", `/api/local/problems/${firstProblemSeq}/retry`, { override: true });
  const rowAfter = (await lq(`SELECT base, override, status FROM local_outbox WHERE seq=$1`, [firstProblemSeq]))[0];
  check("override: the entry's base is the order's CURRENT cloud updated_at (not the stale one)", r.status === 200 && r.json?.override === true && rowAfter.override === true && baseMatches(cloudNow, rowAfter.base) && rowAfter.base !== rowBefore.base,
    `${rowBefore.base} -> ${rowAfter.base} (cloud ${cloudNow})`);
  check("override is written to this PC's local audit", (await lq(`SELECT action, outbox_seq, approver FROM local_audit WHERE action='sync.conflict_override'`)).some((x) => Number(x.outbox_seq) === firstProblemSeq && x.approver === "u:2"));
  await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE order_id=$1 AND status<>'sent'`, [orderB]))[0].n === 0, 15000);
  const ov = replays.slice(replaysBefore).find((x) => x.method === "PUT" && x.path === `/api/orders/${orderB}/items`);
  check("the replay carries X-Replay-Override (so the cloud audit shows overrideOf) and the fresh base", ov?.headers["x-replay-override"] === String(firstProblemSeq) && baseMatches(cloudNow, String(ov?.headers["x-replay-base"])));
  check("the later held entry of the order flowed after the override", (await lq(`SELECT status FROM local_outbox WHERE order_id=$1`, [orderB])).every((x) => x.status === "sent"));

  // a non-conflict problem keeps its ORIGINAL base on retry; discard works with a PIN
  r = await mgr.call("POST", "/api/orders", { orderType: "dine-in", tableId: 2, items }); const orderD = r.json?.id;
  await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE order_id=$1 AND status<>'sent'`, [orderD]))[0].n === 0, 15000);
  ctl.refuse.add(`PUT /api/orders/${orderD}/items`);
  await mgr.call("PUT", `/api/orders/${orderD}/items`, { items: [{ ...items[0], quantity: 4 }] });
  await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE order_id=$1 AND status='problem'`, [orderD]))[0].n === 1, 15000);
  const dProb = (await lq(`SELECT seq, base, last_code FROM local_outbox WHERE order_id=$1 AND status='problem'`, [orderD]))[0];
  check("a non-conflict refusal is a problem with its own code", dProb?.last_code === "bad_thing", JSON.stringify(dProb));
  await mgr2.call("POST", "/api/auth/verify-pin", { pin: "2222", requiredRole: "manager" });
  r = await mgr2.call("POST", `/api/local/problems/${dProb.seq}/retry`, {});
  const dAfter = (await lq(`SELECT base, override FROM local_outbox WHERE seq=$1`, [dProb.seq]))[0];
  check("retry (non-conflict, with PIN) keeps the ORIGINAL base and is not an override", r.status === 200 && dAfter.base === dProb.base && dAfter.override === false, `${dProb.base} vs ${dAfter.base}`);
  await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE order_id=$1 AND status='problem'`, [orderD]))[0].n === 1, 15000);
  await mgr2.call("POST", "/api/auth/verify-pin", { pin: "2222", requiredRole: "manager" });
  const disc = await mgr2.call("POST", `/api/local/problems/${dProb.seq}/discard`, {});
  check("after a PIN, discard marks the problem discarded and audits it", disc.status === 200 && (await status()).problems === 0
    && (await lq(`SELECT 1 FROM local_audit WHERE action='sync.discard'`)).length === 1, JSON.stringify(disc.json));

  // approver rides along on a PIN-approved action
  const sam2 = new Client();
  await sam2.call("POST", "/api/auth/card-login", { kind: "staff", id: 7, pin: "3333" });
  r = await sam2.call("PUT", `/api/orders/${orderC}/cancel`, { reason: "test" });
  check("a staff session cannot cancel without a PIN (server-enforced offline too)", r.status === 403, String(r.status));
  await sam2.call("POST", "/api/auth/verify-pin", { pin: "2222", requiredRole: "manager" });
  r = await sam2.call("PUT", `/api/orders/${orderC}/cancel`, { reason: "test" });
  check("with a typed manager PIN the cancel works and queues the approver", r.status === 200 && (await lq(`SELECT approver, actor FROM local_outbox WHERE path LIKE '%/cancel' ORDER BY seq DESC LIMIT 1`))[0]?.approver === "u:2");
  await until(async () => (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE status='pending'`))[0].n === 0);
  const cancelReplay = replays.filter((x) => x.path.endsWith("/cancel")).pop();
  check("replayed cancel carries X-Replay-Approver and the staff actor (sm:7)", cancelReplay?.headers["x-replay-approver"] === "u:2" && cancelReplay?.headers["x-replay-actor"] === "sm:7");

  // ── online limits stay: PIN lockout ──
  const probe = new Client();
  await probe.call("POST", "/api/auth/card-login", { kind: "staff", id: 7, pin: "3333" });
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await probe.call("POST", "/api/auth/verify-pin", { pin: "0000", requiredRole: "manager" })).status;
  void 0;
  check("verify-pin lockout: the 6th wrong PIN in a session is rate limited (429)", last === 429);

  // ── schema rebuild never drops the outbox / leases ──
  const { ensureLocalSchema } = await import("../server/local/localSchema");
  const { LOCAL_SCHEMA_STATEMENTS } = await import("../server/local/schema.generated");
  await localClient!.query(`INSERT INTO local_outbox (method, path, idem_key, actor) VALUES ('POST','/api/orders','blocked-key-0001','u:2')`);
  const blocked = await ensureLocalSchema(localClient!, [...LOCAL_SCHEMA_STATEMENTS, `CREATE TABLE IF NOT EXISTS zz_changed (id int)`]);
  check("a required rebuild with pending entries is REFUSED (schemaBlocked), data untouched",
    blocked.blocked === true && blocked.recreated === false && (await lq(`SELECT count(*)::int AS n FROM local_outbox WHERE status='pending'`))[0].n === 1);
  await localClient!.query(`UPDATE local_outbox SET status='sent' WHERE idem_key='blocked-key-0001'`);
  const leasesBefore = (await lq(`SELECT count(*)::int AS n FROM local_leases`))[0].n;
  const rebuilt = await ensureLocalSchema(localClient!, [...LOCAL_SCHEMA_STATEMENTS, `CREATE TABLE IF NOT EXISTS zz_changed (id int)`]);
  check("with nothing unsynced the rebuild runs but KEEPS the leases", rebuilt.recreated === true && (await lq(`SELECT count(*)::int AS n FROM local_leases`))[0].n === leasesBefore && leasesBefore > 0);

  // ── done ──
  runtime.worker.stop();
  await new Promise((r2) => server.close(() => r2(null)));
  await new Promise((r2) => cloudSrv.close(() => r2(null)));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  void origError;
  if (failures) { console.error(`\n${failures} local-offline check(s) FAILED`); process.exit(1); }
  console.log("\nAll local-offline checks passed");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
