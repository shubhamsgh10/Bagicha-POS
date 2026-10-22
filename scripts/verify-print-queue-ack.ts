/**
 * Verifies desktop/print/printQueue.ts — the shop PC's print queue. After a ticket is physically printed
 * the host tells the server ("/api/print/ack", up to 3 attempts with 1 s / 3 s backoff). That call used to
 * be AWAITED before the next ticket could start, so a KOT and a Bill tapped together printed one after the
 * other with a network round trip (0.3–0.5 s, or 1–4 s when the ack retried) wedged between them
 * (production p90 7.5 s for pairs vs 5.0 s alone). Now the next ticket starts as soon as the previous one
 * is printed and the ack finishes in the background. Printing stays strictly one-at-a-time, and an ack
 * failure must NEVER re-run a print (that would print the ticket twice).
 * Uses a temp dir, a fake executor and a stubbed fetch — no printer, no network, no Electron.
 * Run: npx tsx scripts/verify-print-queue-ack.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PrintQueue } from "../desktop/print/printQueue";

const checks: Array<[string, boolean]> = [];
const add = (name: string, ok: boolean) => checks.push([name, ok]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > timeoutMs) return false; await sleep(5); }
  return true;
}

const realFetch = globalThis.fetch;
const dirs: string[] = [];

interface Opts {
  execMs?: number;
  /** order ids whose print throws on the first N attempts */
  failPrint?: Record<number, number>;
  /** order ids whose ack answers HTTP 500 */
  failAck?: Set<number>;
  /** order ids whose ack hangs until released */
  holdAck?: Set<number>;
}

function harness(o: Opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "print-queue-test-"));
  dirs.push(dir);
  const events: string[] = [];
  const acks: Array<{ orderId: number; type: string; jobId?: number }> = [];
  const released: number[] = [];
  const printCalls: Record<number, number> = {};
  const releaseAck: Record<number, () => void> = {};
  let active = 0, maxActive = 0;

  (globalThis as any).fetch = async (url: string, init: any) => {
    if (url.endsWith("/api/print/ack")) {
      const body = JSON.parse(init.body);
      acks.push(body);
      events.push(`ack:${body.orderId}:start`);
      if (o.holdAck?.has(body.orderId)) await new Promise<void>((r) => { releaseAck[body.orderId] = r; });
      events.push(`ack:${body.orderId}:end`);
      return { ok: !o.failAck?.has(body.orderId), status: o.failAck?.has(body.orderId) ? 500 : 200 } as Response;
    }
    if (/\/api\/print\/jobs\/\d+\/release$/.test(url)) {
      released.push(Number(url.match(/jobs\/(\d+)\/release/)![1]));
      return { ok: true, status: 200 } as Response;
    }
    return { ok: true, status: 200 } as Response;
  };

  const queue = new PrintQueue(
    dir,
    async () => [],
    async () => "c=1",
    () => "http://test",
    undefined,
    {
      execute: async (job) => {
        const id = job.orderId!;
        printCalls[id] = (printCalls[id] ?? 0) + 1;
        events.push(`print:${id}:start`);
        active++; maxActive = Math.max(maxActive, active);
        await sleep(o.execMs ?? 15);
        active--;
        if (printCalls[id] <= (o.failPrint?.[id] ?? 0)) { events.push(`print:${id}:fail`); throw new Error("printer offline"); }
        events.push(`print:${id}:end`);
      },
      ackDelaysMs: [0, 5, 5],
      retryDelaysMs: [0, 20, 20, 20],
    },
  );
  const job = (orderId: number, type: "kot" | "bill", jobId: number) => ({
    printJob: { printerId: "p1", encoding: "escpos-base64" as const, data: "AA==", orderId, ackType: type, jobId },
    type, orderId, ackType: type,
  });
  return { queue, events, acks, released, printCalls, releaseAck, job, maxActive: () => maxActive };
}

(async () => {
  // 1. THE FIX: ticket 2 prints while ticket 1's ack is still hanging.
  {
    const h = harness({ holdAck: new Set([1]) });
    h.queue.enqueue(h.job(1, "kot", 11));
    h.queue.enqueue(h.job(2, "bill", 12));
    const secondPrinted = await waitFor(() => h.events.includes("print:2:end"), 1500);
    add("ticket 2 is printed even though ticket 1's ack has not come back", secondPrinted && !h.events.includes("ack:1:end"));
    add("…ticket 1's ack was started (in the background)", h.events.includes("ack:1:start"));
    h.releaseAck[1]?.();
    const allAcked = await waitFor(() => h.events.includes("ack:1:end") && h.events.includes("ack:2:end"));
    add("both tickets are acknowledged in the end", allAcked && h.acks.length === 2);
    add("acks carry the right order, type and job id",
      h.acks.some((a) => a.orderId === 1 && a.type === "kot" && a.jobId === 11) &&
      h.acks.some((a) => a.orderId === 2 && a.type === "bill" && a.jobId === 12));
    add("the queue is empty afterwards (printed jobs are removed)", h.queue.getStatus().length === 0);
  }

  // 2. Printing is still strictly one at a time, in order.
  {
    const h = harness({ execMs: 25 });
    h.queue.enqueue(h.job(1, "kot", 21));
    h.queue.enqueue(h.job(2, "bill", 22));
    h.queue.enqueue(h.job(3, "kot", 23));
    await waitFor(() => h.events.filter((e) => e.endsWith(":end") && e.startsWith("print:")).length === 3);
    add("never more than one ticket is printing at a time", h.maxActive() === 1);
    const order = h.events.filter((e) => e.startsWith("print:") && e.endsWith(":start")).map((e) => e.split(":")[1]).join(",");
    add("tickets print in the order they were queued", order === "1,2,3");
  }

  // 3. An ack that fails every time never re-prints the ticket, and never blocks the next one.
  {
    const h = harness({ failAck: new Set([1]) });
    h.queue.enqueue(h.job(1, "kot", 31));
    h.queue.enqueue(h.job(2, "bill", 32));
    await waitFor(() => h.acks.filter((a) => a.orderId === 1).length === 3 && h.events.includes("ack:2:end"));
    await sleep(60);
    add("a permanently failing ack is retried (3 attempts)…", h.acks.filter((a) => a.orderId === 1).length === 3);
    add("…but the ticket is printed exactly ONCE (never a duplicate)", h.printCalls[1] === 1);
    add("…and the next ticket still prints and is acked", h.printCalls[2] === 1 && h.events.includes("ack:2:end"));
    add("…and the failed-ack job is not left stuck in the queue", h.queue.getStatus().length === 0);
  }

  // 4. A print that fails is still retried, then acked once it finally prints.
  {
    const h = harness({ failPrint: { 3: 1 } });
    h.queue.enqueue(h.job(3, "kot", 41));
    await waitFor(() => h.events.includes("ack:3:end"));
    add("a failed print is retried and then succeeds (printed twice in total: 1 fail + 1 ok)", h.printCalls[3] === 2 && h.events.includes("print:3:end"));
    add("no ack is sent for the failed attempt, exactly one for the success", h.acks.filter((a) => a.orderId === 3).length === 1);
  }

  // 5. A print that never succeeds is handed back to the server and does not wedge the queue.
  {
    const h = harness({ failPrint: { 4: 99 } });
    h.queue.enqueue(h.job(4, "kot", 51));
    h.queue.enqueue(h.job(5, "bill", 52));
    await waitFor(() => h.released.includes(51) && h.events.includes("ack:5:end"), 3000);
    add("a print that fails 4 times is released back to the server (job 51)", h.released.includes(51));
    add("…and the next ticket still prints and is acked", h.printCalls[5] === 1 && h.events.includes("ack:5:end"));
    add("…with no ack ever sent for the ticket that never printed", !h.acks.some((a) => a.orderId === 4));
  }

  (globalThis as any).fetch = realFetch;
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
