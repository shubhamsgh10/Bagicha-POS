// Local-first phase 4A: replay middleware, lease rules, base check, X-Replay-At, _auth, print
// suppression, the phase-4 migration and the lease SQL (PGlite, in memory).
// Never loads dotenv and points DATABASE_URL at a dead address, so the production DB is unreachable.
process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:9/none"; // lazy pool: nothing connects
delete process.env.BAGICHA_LOCAL_MODE;
delete process.env.BAGICHA_DB;

import crypto from "crypto";
import { PGlite } from "@electric-sql/pglite";
import { schemaStatements } from "./lib/pgliteSchema";
import {
  parsePrincipalRef, parseReplayAt, baseMatches, normalizeTimestamp, isReplayable, baseTargetFor, inAnyLease,
  parseClientOrderNumber, parseClientKotNumber, parseClientId, shouldDispatchPrint, replayFlagSet,
} from "../shared/replayRules";
import { grantElevation, hasElevation, hasFreshPin, freshPinApprover } from "../server/elevation";
import { planPaymentEdit } from "../shared/paymentEdit";
import { businessDateOf } from "../shared/businessDay";
import { migrationStatements, phase4MigrationStatements, PHASE4_ROLLBACK_SQL, fetchRowsSql, collapseChanges, snapshotPageSql } from "../server/sync/changeLogSql";
import { PHASE4_NEW_TABLES, SYNC_TABLES_V2, LEASE_MAX_PER_HOUR } from "../shared/syncTables";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { makeReplayMiddleware, replayNow } = await import("../server/sync/replay");
  const { attachAuth, buildAuthBlob } = await import("../server/sync/authBlob");
  const { verifyPassword, hashPassword } = await import("../server/passwordHash");
  const leases = await import("../server/sync/leases");

  // ── pure rules ──
  check("principal refs: u:/sm: only", parsePrincipalRef("u:5")?.kind === "u" && parsePrincipalRef("sm:12")?.id === 12
    && parsePrincipalRef("5") === null && parsePrincipalRef("u:0") === null && parsePrincipalRef("admin") === null
    && parsePrincipalRef("u:5 ") !== null && parsePrincipalRef("u:5;drop") === null && parsePrincipalRef(undefined) === null);
  check("replay flag must be exactly 1", replayFlagSet("1") && !replayFlagSet("true") && !replayFlagSet(undefined) && !replayFlagSet("01"));

  const NOW = Date.parse("2026-11-14T12:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  check("X-Replay-At: a moment ago is accepted", parseReplayAt(iso(NOW - 5_000), NOW)?.getTime() === NOW - 5_000);
  check("X-Replay-At: +1 min skew is accepted", parseReplayAt(iso(NOW + 60_000), NOW) !== null);
  check("X-Replay-At: +3 min (future) is ignored", parseReplayAt(iso(NOW + 180_000), NOW) === null);
  check("X-Replay-At: 47 h old is accepted", parseReplayAt(iso(NOW - 47 * 3600_000), NOW) !== null);
  check("X-Replay-At: 49 h old is ignored", parseReplayAt(iso(NOW - 49 * 3600_000), NOW) === null);
  check("X-Replay-At: garbage / no timezone / absent is ignored",
    parseReplayAt("yesterday", NOW) === null && parseReplayAt("2026-11-14T11:00:00", NOW) === null
    && parseReplayAt(undefined, NOW) === null && parseReplayAt("", NOW) === null && parseReplayAt(12345 as any, NOW) === null);

  check("base: identical microsecond text matches", baseMatches("2026-11-14T10:00:00.123456", "2026-11-14T10:00:00.123456"));
  check("base: Postgres JSON form (trailing zeros dropped) matches", baseMatches("2026-11-14T10:00:00.120000", "2026-11-14T10:00:00.12"));
  check("base: millisecond (JS Date) base matches at ms", baseMatches("2026-11-14T10:00:00.123000", "2026-11-14T10:00:00.123Z"));
  check("base: ms base does not match a different ms", !baseMatches("2026-11-14T10:00:00.124000", "2026-11-14T10:00:00.123Z"));
  check("base: a different microsecond does not match a full-precision base", !baseMatches("2026-11-14T10:00:00.123457", "2026-11-14T10:00:00.123456"));
  check("base: junk never matches", !baseMatches("2026-11-14T10:00:00.123456", "soon") && !baseMatches(null, "2026-11-14T10:00:00") && normalizeTimestamp("x") === null);

  check("replay list accepts the plan's routes",
    isReplayable("POST", "/api/orders") && isReplayable("PUT", "/api/orders/5/items") && isReplayable("PUT", "/api/orders/5")
    && isReplayable("POST", "/api/orders/5/payment") && isReplayable("PUT", "/api/orders/5/cancel") && isReplayable("PUT", "/api/orders/5/hold")
    && isReplayable("PUT", "/api/orders/5/recall") && isReplayable("PUT", "/api/orders/5/move-table") && isReplayable("POST", "/api/tables/3/shift")
    && isReplayable("POST", "/api/print/kot") && isReplayable("POST", "/api/print/bill") && isReplayable("POST", "/api/orders/5/bill-requested")
    && isReplayable("PUT", "/api/kot/9") && isReplayable("POST", "/api/orders/5/settle-due") && isReplayable("POST", "/api/orders/5/payment-method"));
  check("replay list refuses everything else (reads, admin, merge/split, ebill, verify-pin)",
    !isReplayable("GET", "/api/orders") && !isReplayable("GET", "/api/users") && !isReplayable("POST", "/api/orders/merge")
    && !isReplayable("POST", "/api/orders/5/split") && !isReplayable("POST", "/api/orders/5/ebill") && !isReplayable("POST", "/api/auth/verify-pin")
    && !isReplayable("DELETE", "/api/orders/5") && !isReplayable("POST", "/api/users") && !isReplayable("PUT", "/api/menu/3")
    && !isReplayable("POST", "/api/orders/x/payment") && !isReplayable("POST", "/api/sync/lease"));
  check("base targets", baseTargetFor("PUT", "/api/orders/7/items")?.kind === "order" && baseTargetFor("POST", "/api/tables/2/shift")?.kind === "table"
    && baseTargetFor("PUT", "/api/kot/4")?.kind === "kot" && baseTargetFor("POST", "/api/print/bill")?.kind === "body_order" && baseTargetFor("POST", "/api/orders") === null);

  const ls = [{ startValue: 100, endValue: 199 }, { startValue: 500, endValue: 509 }];
  check("lease range: inside / edges / outside / junk", inAnyLease(100, ls) && inAnyLease(199, ls) && inAnyLease(505, ls)
    && !inAnyLease(99, ls) && !inAnyLease(200, ls) && !inAnyLease(510, ls) && !inAnyLease(0, ls) && !inAnyLease(1.5, ls) && !inAnyLease(NaN, ls));
  check("client numbers: only canonical spellings", parseClientOrderNumber("ORD0123") === 123 && parseClientOrderNumber("ORD123") === null
    && parseClientOrderNumber("ORD00123") === null && parseClientOrderNumber("ORD12345") === 12345 && parseClientOrderNumber("xORD0123") === null
    && parseClientKotNumber("007") === 7 && parseClientKotNumber("7") === null && parseClientKotNumber("0007") === null && parseClientKotNumber("1234") === 1234
    && parseClientId(5) === 5 && parseClientId("5") === null && parseClientId(0) === null && parseClientId(1.5) === null && parseClientId(3e9) === null);

  // ── print suppression decision ──
  check("print dispatch is suppressed only for a validated replay", !shouldDispatchPrint({ replay: { deviceId: 1 } })
    && shouldDispatchPrint({}) && shouldDispatchPrint({ headers: { "x-bagicha-replay": "1" } }) && shouldDispatchPrint(undefined));

  // ── per-request elevation from the approver ──
  {
    const sessionBefore = {};
    const staffReq: any = { user: { role: "staff" }, session: sessionBefore, replay: { deviceId: 1, approver: { id: "u:2", name: "Boss", role: "manager", level: 1 } } };
    check("replay approver satisfies hasElevation(manager) for a staff actor", hasElevation(staffReq, "manager"));
    check("replay approver satisfies hasFreshPin(manager) and freshPinApprover returns them",
      hasFreshPin(staffReq, "manager") && freshPinApprover(staffReq)?.id === "u:2" && freshPinApprover(staffReq)?.name === "Boss");
    check("manager approver does not satisfy an admin gate", !hasElevation(staffReq, "admin") && !hasFreshPin(staffReq, "admin"));
    check("elevation from a replay never writes the session", Object.keys(sessionBefore).length === 0);
    const admin: any = { user: { role: "staff" }, session: {}, replay: { deviceId: 1, approver: { id: "u:1", name: "Owner", role: "admin", level: 2 } } };
    check("admin approver satisfies the admin gate", hasElevation(admin, "admin") && hasFreshPin(admin, "admin"));
    const plain: any = { user: { role: "staff" }, session: {} };
    check("no replay, no elevation (unchanged)", !hasElevation(plain, "manager") && !hasFreshPin(plain, "manager") && freshPinApprover(plain) === null);
    const noApprover: any = { user: { role: "staff" }, session: {}, replay: { deviceId: 1, approver: null } };
    check("replay without an approver gives a staff actor nothing", !hasElevation(noApprover, "manager") && !hasFreshPin(noApprover, "manager"));
    const forged: any = { user: { role: "staff" }, session: {}, headers: { "x-replay-approver": "u:1" } };
    check("a header on the request object grants nothing by itself", !hasElevation(forged, "manager"));
    const sess: any = { user: { role: "manager" }, session: {} };
    grantElevation(sess, 1);
    check("session elevation still works as before", hasFreshPin(sess, "manager"));
  }

  // ── X-Replay-At feeds the payment-method "today" rule ──
  {
    // Paid 22:30 IST on 13 Nov. The shop PC corrects it at 23:30 IST the same evening while offline;
    // the cloud replays it next morning (14 Nov, 12:00 UTC = 17:30 IST).
    const paidAt = "2026-11-13T22:30:00.000+05:30";
    const orderRow: any = { paymentStatus: "paid", status: "served", createdAt: paidAt, paidAt, totalAmount: "100.00", paidAmount: "100.00", changeAmount: "0.00", paymentBreakdown: { cash: "100" }, paymentMethod: "cash" };
    const req = (at: Date | null): any => ({ replay: { deviceId: 1, at } });
    const atPc = parseReplayAt("2026-11-13T23:30:00.000+05:30", NOW)!;
    const todayWith = businessDateOf(replayNow(req(atPc)));
    const todayWithout = businessDateOf(replayNow(req(null)));
    check("replayNow uses X-Replay-At when accepted, the clock otherwise", replayNow(req(atPc)).getTime() === atPc.getTime() && Math.abs(replayNow({}).getTime() - Date.now()) < 5_000);
    const early = planPaymentEdit(orderRow, { cash: 0, upi: 100, reason: "wrong method" }, todayWith);
    check("payment-method with X-Replay-At: the PC's evening is still 'today' (accepted)", early.ok === true, JSON.stringify(early.ok ? "" : early));
    const late = planPaymentEdit(orderRow, { cash: 0, upi: 100, reason: "wrong method" }, businessDateOf(new Date("2026-11-14T12:00:00Z")));
    check("same edit without it uses the next morning and is too_old", late.ok === false && (late as any).code === "too_old", JSON.stringify(late.ok ? "" : late));
    check("business dates differ as expected", todayWith === "2026-11-13" && todayWithout >= "2026-11-14");
    const tooOldAt = parseReplayAt("2026-11-10T10:00:00.000+05:30", NOW);
    check("an X-Replay-At older than 48 h cannot reopen the correction window", tooOldAt === null);
  }

  // ── middleware (fake deps) ──
  {
    const users: Record<number, any> = {
      1: { id: 1, username: "owner", role: "admin", password: "x", pin: "1111" },
      2: { id: 2, username: "boss", role: "manager" },
      3: { id: 3, username: "waiter-user", role: "staff" },
    };
    const staff: Record<number, any> = { 7: { id: 7, name: "Sam", designation: "Service" } };
    const orderUpdated: Record<number, string> = { 50: "2026-11-14T10:00:00.123456" };
    let authCalls = 0;
    let authMode: "ok" | "none" | "down" = "ok";
    const seenKeys = new Set<string>();
    const mw = makeReplayMiddleware({
      authenticate: async () => {
        authCalls++;
        if (authMode === "down") throw new Error("db down");
        return authMode === "ok" ? { id: 9, lastSeenAt: null } : null;
      },
      loadUser: async (id) => users[id],
      loadStaff: async (id) => staff[id],
      orderUpdatedAt: async (id) => orderUpdated[id] ?? null,
      orderIdOfTable: async (id) => (id === 3 ? 50 : null),
      orderIdOfKot: async (id) => (id === 4 ? 50 : null),
      requestKeySeen: async (k) => seenKeys.has(k),
      now: () => NOW,
    });
    const run = async (method: string, url: string, headers: Record<string, string>, body: any = {}) => {
      const session = {};
      const req: any = { method, originalUrl: url, url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), body, session, user: undefined };
      let status = 0; let json: any = null; let nexted = false;
      const res: any = { status(c: number) { status = c; return this; }, json(b: any) { json = b; return this; }, setHeader() {} };
      await mw(req, res, () => { nexted = true; });
      return { req, status, json, nexted, session };
    };
    const good = { "X-Bagicha-Replay": "1", Authorization: "Bearer " + "a".repeat(64), "X-Replay-Actor": "u:3" };

    authMode = "ok"; authCalls = 0;
    let r = await run("PUT", "/api/orders/50/items", { Authorization: good.Authorization, "X-Replay-Actor": "u:1", "X-Replay-Approver": "u:1" });
    check("no replay flag: untouched, no auth work, no identity", r.nexted && !r.req.replay && r.req.user === undefined && authCalls === 0);

    authMode = "none";
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Approver": "u:1", "X-Replay-Base": "2026-01-01T00:00:00", "X-Replay-At": new Date(NOW).toISOString() });
    check("replay headers WITHOUT a valid device token are ignored completely",
      r.nexted && r.status === 0 && !r.req.replay && r.req.user === undefined && r.req.isAuthenticated === undefined && Object.keys(r.session).length === 0);
    authMode = "down";
    r = await run("PUT", "/api/orders/50/items", good);
    check("token check unavailable gives 503, not a silent normal request", !r.nexted && r.status === 503);

    authMode = "ok";
    r = await run("GET", "/api/orders", good);
    check("valid token but not a replayable request gives 403", !r.nexted && r.status === 403 && r.json.code === "replay_not_allowed" && !r.req.replay);
    r = await run("POST", "/api/users", good);
    check("valid token cannot create users via replay", !r.nexted && r.status === 403);
    r = await run("PUT", "/api/orders/50/items", { "X-Bagicha-Replay": "1", Authorization: good.Authorization });
    check("missing actor gives 401", !r.nexted && r.status === 401);
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Actor": "u:99" });
    check("unknown user actor gives 401", !r.nexted && r.status === 401);
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Actor": "sm:99" });
    check("unknown staff actor gives 401", !r.nexted && r.status === 401);
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Actor": "admin" });
    check("garbage actor gives 401", !r.nexted && r.status === 401);

    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Actor": "u:2" });
    check("user actor: principal is the DB row, authenticated, replay context set, session untouched",
      r.nexted && r.req.user === users[2] && r.req.isAuthenticated() === true && r.req.replay.deviceId === 9 && r.req.replay.actor === "u:2"
      && r.req.replay.approver === null && Object.keys(r.session).length === 0);
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Actor": "sm:7" });
    check("staff-member actor: principal built like deserializeUser",
      r.nexted && JSON.stringify(r.req.user) === JSON.stringify({ id: 7, username: "Sam", role: "staff", designation: "Service", _isStaffMember: true }));

    r = await run("POST", "/api/orders/50/payment-method", { ...good, "X-Replay-Approver": "u:2" });
    check("manager approver accepted (level 1), others fine", r.nexted && r.req.replay.approver.id === "u:2" && r.req.replay.approver.level === 1);
    r = await run("POST", "/api/orders/50/payment-method", { ...good, "X-Replay-Approver": "u:1" });
    check("admin approver accepted (level 2)", r.nexted && r.req.replay.approver.level === 2);
    r = await run("POST", "/api/orders/50/payment-method", { ...good, "X-Replay-Approver": "u:3" });
    check("staff-role user as approver gives 403", !r.nexted && r.status === 403 && r.json.code === "invalid_approver");
    r = await run("POST", "/api/orders/50/payment-method", { ...good, "X-Replay-Approver": "sm:7" });
    check("staff member as approver gives 403", !r.nexted && r.status === 403);
    r = await run("POST", "/api/orders/50/payment-method", { ...good, "X-Replay-Approver": "u:77" });
    check("unknown approver gives 403", !r.nexted && r.status === 403);
    r = await run("POST", "/api/orders/50/payment-method", { ...good, "X-Replay-Approver": "manager" });
    check("malformed approver gives 403", !r.nexted && r.status === 403);

    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Base": "2026-11-14T10:00:00.123456" });
    check("base equal passes", r.nexted && r.req.replay.base === "2026-11-14T10:00:00.123456");
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Base": "2026-11-14T09:59:59.000000" });
    check("base differs gives 409 conflict", !r.nexted && r.status === 409 && r.json.code === "conflict");
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Base": "nonsense" });
    check("bad base gives 400", !r.nexted && r.status === 400);
    r = await run("PUT", "/api/orders/51/items", { ...good, "X-Replay-Base": "2026-01-01T00:00:00" });
    check("base on an order that does not exist falls through to the route's 404", r.nexted);
    seenKeys.add("idem-1");
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Base": "2026-01-01T00:00:00", "Idempotency-Key": "idem-1" });
    check("base is not re-checked for a retry whose Idempotency-Key already ran", r.nexted);
    r = await run("PUT", "/api/orders/50/items", { ...good, "X-Replay-Base": "2026-01-01T00:00:00", "Idempotency-Key": "idem-2" });
    check("an unseen key still gets the base check", !r.nexted && r.status === 409);
    r = await run("POST", "/api/tables/3/shift", { ...good, "X-Replay-Base": "2026-01-01T00:00:00" });
    check("base check follows a table shift to its order", !r.nexted && r.status === 409);
    r = await run("PUT", "/api/kot/4", { ...good, "X-Replay-Base": "2026-11-14T10:00:00.123456" });
    check("base check follows a kot ticket to its order (match passes)", r.nexted);
    r = await run("POST", "/api/print/kot", { ...good, "X-Replay-Base": "2026-01-01T00:00:00" }, { orderId: 50 });
    check("base check reads body.orderId for print", !r.nexted && r.status === 409);
    r = await run("POST", "/api/orders", { ...good, "X-Replay-Base": "2026-01-01T00:00:00" }, { items: [] });
    check("order creation has no base check", r.nexted);

    r = await run("POST", "/api/orders/50/payment", { ...good, "X-Replay-At": new Date(NOW - 3600_000).toISOString() });
    check("X-Replay-At within bounds is carried on the context", r.nexted && r.req.replay.at?.getTime() === NOW - 3600_000);
    r = await run("POST", "/api/orders/50/payment", { ...good, "X-Replay-At": new Date(NOW + 10 * 60_000).toISOString() });
    check("X-Replay-At in the future is dropped (now is used)", r.nexted && r.req.replay.at === null);
    r = await run("POST", "/api/orders/50/payment", { ...good, "X-Replay-At": new Date(NOW - 72 * 3600_000).toISOString() });
    check("X-Replay-At older than 48 h is dropped", r.nexted && r.req.replay.at === null);
  }

  // ── _auth ──
  {
    const hashed = await hashPassword("secret-pw");
    const blob = await buildAuthBlob({ password: hashed, pin: "4821" });
    check("_auth.pw is the stored scrypt hash as is", blob.pw === hashed && await verifyPassword("secret-pw", blob.pw!));
    check("_auth.pin verifies with the same scrypt routine", !!blob.pin && await verifyPassword("4821", blob.pin!) && !(await verifyPassword("4822", blob.pin!)));
    check("_auth never contains the plaintext PIN", !JSON.stringify(blob).includes("4821"));
    const blob2 = await buildAuthBlob({ password: hashed, pin: "4821" });
    check("_auth.pin uses a fresh random salt each time", blob.pin !== blob2.pin && blob.pin!.split(":")[0] !== blob2.pin!.split(":")[0]);
    check("no pin / no password gives an empty blob", Object.keys(await buildAuthBlob({ password: null, pin: null })).length === 0);
  }

  // ── PGlite: migration, auth rows, leases ──
  const db = new PGlite();
  await db.waitReady;
  for (const s of await schemaStatements()) await db.exec(s);
  for (const s of migrationStatements()) await db.exec(s); // phase-3 first
  for (const s of phase4MigrationStatements()) await db.exec(s);
  let again = true;
  try { for (const s of phase4MigrationStatements()) await db.exec(s); } catch (e: any) { again = false; console.log(e.message); }
  check("phase-4 migration is idempotent", again);
  const q = async (sql: string, params: any[] = []) => (await db.query<any>(sql, params)).rows;
  let trig = 0;
  for (const t of PHASE4_NEW_TABLES) {
    trig += (await q(`SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid WHERE c.relname = $1 AND tg.tgname = 'change_log_capture'`, [t])).length;
  }
  check("all 12 new tables have the trigger", trig === PHASE4_NEW_TABLES.length, String(trig));
  check("SYNC_TABLES_V2 = 21 tables", SYNC_TABLES_V2.length === 21);
  const rls = await q(`SELECT relrowsecurity FROM pg_class WHERE relname = 'device_leases'`);
  check("device_leases has RLS on", rls[0]?.relrowsecurity === true);

  // trigger capture on uuid-id table + uuid collapse/fetch
  await q(`DELETE FROM change_log`);
  const cm = (await q(`INSERT INTO customers_master (key, name) VALUES ('9999999999','Test') RETURNING id`))[0].id;
  await q(`UPDATE customers_master SET name='T2' WHERE id = $1`, [cm]);
  const cl = await q(`SELECT table_name, row_id, op FROM change_log ORDER BY seq`);
  check("customers_master (uuid id) writes are captured", cl.length === 2 && cl[0].row_id === cm);
  const col = collapseChanges(cl as any);
  check("collapse keeps uuid ids as strings", col.length === 1 && col[0].id === cm && col[0].op === "U");
  const fr = await q(fetchRowsSql("customers_master"), [[cm]]);
  check("fetchRowsSql handles uuid ids", fr.length === 1 && fr[0].j.name === "T2");
  await q(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type) VALUES ('u:1','a','admin','x','y')`);
  check("audit_logs writes are captured", (await q(`SELECT 1 FROM change_log WHERE table_name='audit_logs'`)).length === 1);

  // paged snapshot
  for (let i = 0; i < 5; i++) await q(`INSERT INTO categories (name) VALUES ($1)`, ["c" + i]);
  const p1 = await q(snapshotPageSql("categories"), [null, 2]);
  const p2 = await q(snapshotPageSql("categories"), [String(p1[p1.length - 1].id), 2]);
  const p3 = await q(snapshotPageSql("categories"), [String(p2[p2.length - 1].id), 2]);
  check("snapshot pages walk the table by id without gaps or repeats",
    p1.length === 2 && p2.length === 2 && p3.length === 1 && new Set([...p1, ...p2, ...p3].map((r) => r.id)).size === 5);
  const up = await q(snapshotPageSql("customers_master"), [null, 10]);
  check("uuid table pages too", up.length === 1 && up[0].j.name === "T2");

  // _auth from the DB (users / staff_members)
  const pwHash = await hashPassword("pw1");
  await q(`INSERT INTO users (username, password, role, pin) VALUES ('mgr', $1, 'manager', '5566')`, [pwHash]);
  await q(`INSERT INTO staff_members (name, pin) VALUES ('Sam','7788')`);
  const uRow = (await q(fetchRowsSql("users"), [[(await q(`SELECT id FROM users WHERE username='mgr'`))[0].id]]))[0].j;
  const sRow = (await q(fetchRowsSql("staff_members"), [[(await q(`SELECT id FROM staff_members WHERE name='Sam'`))[0].id]]))[0].j;
  const runner = { query: async (sql: string, params?: unknown[]) => ({ rows: await q(sql, params as any[]) }) };
  await attachAuth(runner, "users", [uRow]);
  await attachAuth(runner, "staff_members", [sRow]);
  check("users row: _auth.pw + hashed pin, still no secret columns",
    uRow._auth.pw === pwHash && await verifyPassword("5566", uRow._auth.pin) && !("pin" in uRow) && uRow.password === "" && !JSON.stringify(uRow).includes("5566"));
  check("staff_members row: hashed pin only", await verifyPassword("7788", sRow._auth.pin) && sRow._auth.pw === undefined && !JSON.stringify(sRow).includes("7788"));

  // ── leases ──
  await q(`DELETE FROM restaurant_settings`);
  await q(`INSERT INTO restaurant_settings (id, settings) VALUES (1, $1::json)`, [JSON.stringify({ billCounter: 100, kotCounter: 40 })]);
  const tx = async <T>(fn: () => Promise<T>) => { await db.exec("BEGIN"); try { const v = await fn(); await db.exec("COMMIT"); return v; } catch (e) { await db.exec("ROLLBACK"); throw e; } };
  const mkOrder = (n: string, id?: number) => q(
    id ? `INSERT INTO orders (id, order_number, order_type, total_amount, tax_amount) VALUES ($2,$1,'takeaway','1','0') RETURNING id`
       : `INSERT INTO orders (order_number, order_type, total_amount, tax_amount) VALUES ($1,'takeaway','1','0') RETURNING id`,
    id ? [n, id] : [n]);
  const before = (await mkOrder("L-0"))[0].id;
  const a = await tx(() => leases.issueLeaseIn(runner, 1, "order_id", 50));
  const b = await tx(() => leases.issueLeaseIn(runner, 2, "order_id", 50));
  check("order-id blocks: right size, adjacent, non-overlapping, after existing ids",
    a.end - a.start === 49 && b.end - b.start === 49 && b.start === a.end + 1 && a.start > before, JSON.stringify([before, a, b]));
  const after = (await mkOrder("L-1"))[0].id;
  check("a normal cloud insert after issuance lands past every issued block", after > b.end, `after=${after} blockEnd=${b.end}`);
  const mid = (await mkOrder("L-leased", a.start + 5))[0].id;
  check("an explicit id inside the block inserts verbatim", mid === a.start + 5);
  let dupStatus = "";
  try { await mkOrder("L-dup", a.start + 5); } catch (e: any) { dupStatus = e?.code ?? "?"; }
  check("the same leased id twice is a unique violation (route maps it to 409)", dupStatus === "23505" && leases.isUniqueViolation({ code: "23505" }) && leases.isUniqueViolation({ cause: { code: "23505" } }) && !leases.isUniqueViolation(new Error("x")));
  const bill1 = await tx(() => leases.issueLeaseIn(runner, 1, "bill_counter", 30));
  const kot1 = await tx(() => leases.issueLeaseIn(runner, 1, "kot_counter", 10));
  check("counter blocks continue after the current value", bill1.start === 101 && bill1.end === 130 && kot1.start === 41 && kot1.end === 50, JSON.stringify([bill1, kot1]));
  const cur = JSON.parse((await q(`SELECT settings::text AS s FROM restaurant_settings WHERE id=1`))[0].s);
  check("settings counters moved past the blocks (cloud issuance continues after them)", cur.billCounter === 130 && cur.kotCounter === 50);
  const bill2 = await tx(() => leases.issueLeaseIn(runner, 2, "bill_counter", 30));
  check("another device's counter block does not overlap", bill2.start === 131 && bill2.end === 160);

  const bodyOk = { clientId: a.start + 1, clientOrderNumber: "ORD" + String(bill1.start + 2).padStart(4, "0"), clientKotNumber: String(kot1.start + 1).padStart(3, "0") };
  let nums = await leases.acceptReplayNumbers(runner, 1, bodyOk, true);
  check("numbers inside the device's leases are accepted verbatim", nums.ok && nums.id === a.start + 1 && nums.billNo === bill1.start + 2 && nums.kotNo === kot1.start + 1, JSON.stringify(nums));
  nums = await leases.acceptReplayNumbers(runner, 2, bodyOk, true);
  check("the same numbers from ANOTHER device are a lease_violation", !nums.ok && nums.code === "lease_violation");
  nums = await leases.acceptReplayNumbers(runner, 1, { clientId: a.end + 1 }, true);
  check("an id just past the block is a lease_violation", !nums.ok);
  nums = await leases.acceptReplayNumbers(runner, 1, { clientOrderNumber: "ORD" + String(bill1.end + 1).padStart(4, "0") }, true);
  check("an order number past the block is a lease_violation", !nums.ok);
  nums = await leases.acceptReplayNumbers(runner, 1, { clientKotNumber: "999" }, true);
  check("a KOT number outside the block is a lease_violation", !nums.ok);
  nums = await leases.acceptReplayNumbers(runner, 1, { clientKotNumber: "999" }, false);
  check("a KOT number is ignored when no ticket is needed", nums.ok && nums.kotNo === undefined);
  nums = await leases.acceptReplayNumbers(runner, 1, { clientOrderNumber: "ORD" + String(bill1.start).padStart(3, "0") }, true);
  check("a non-canonical order number spelling is refused", !nums.ok);
  nums = await leases.acceptReplayNumbers(runner, 1, { clientId: "5" as any }, true);
  check("a non-numeric id is refused", !nums.ok);
  nums = await leases.acceptReplayNumbers(runner, 1, {}, true);
  check("nothing supplied means nothing used (cloud issues)", nums.ok && nums.id === undefined && nums.billNo === undefined && nums.kotNo === undefined);

  // hourly cap
  let capped = "";
  try { for (let i = 0; i < LEASE_MAX_PER_HOUR + 2; i++) await tx(() => leases.issueLeaseIn(runner, 3, "kot_counter", 1)); } catch (e: any) { capped = e?.code ?? ""; }
  check("lease issuance is rate limited per device and kind", capped === "lease_rate_limited");
  check("lease size is clamped", leases.clampLeaseSize(undefined) === 200 && leases.clampLeaseSize(5000) === 1000 && leases.clampLeaseSize(-3) === 200 && leases.clampLeaseSize(7.9) === 7);

  // rollback
  for (const s of PHASE4_ROLLBACK_SQL) await db.exec(s);
  const left = await q(`SELECT to_regclass('device_leases') AS dl, (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid WHERE tg.tgname='change_log_capture' AND c.relname = ANY($1)) AS n, (SELECT count(*) FROM pg_trigger WHERE tgname='change_log_capture') AS all_n`, [Array.from(PHASE4_NEW_TABLES)]);
  check("phase-4 rollback removes the 12 triggers and device_leases, keeps the 9 phase-3 triggers",
    left[0].dl === null && Number(left[0].n) === 0 && Number(left[0].all_n) === 9, JSON.stringify(left[0]));

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
