/**
 * Verifies the realtime publishers' batch path: PusherPublisher.publishMany sends ONE
 * triggerBatch per 10 events (Pusher's per-call cap) instead of one HTTPS call per event, and
 * falls back to per-event trigger when the SDK has no triggerBatch. DB-free.
 * Run: npx tsx scripts/verify-realtime-batch.ts
 */
import { PusherPublisher, LocalWsPublisher, CompositePublisher } from "../server/realtime/publisher";

const checks: Array<[string, boolean]> = [];
const ev = (n: number) => ({ type: "PRINT_JOB", jobId: n, printerId: `p${n}` });

async function main() {
  // 1 event → plain trigger, no batch
  {
    const triggers: any[] = [];
    const batches: any[] = [];
    const pub = new PusherPublisher(
      { trigger: async (c: string, n: string, d: unknown) => { triggers.push([c, n, d]); }, triggerBatch: async (b: any) => { batches.push(b); } },
      "ch",
    );
    await pub.publishMany([ev(1)]);
    checks.push(["1 event uses trigger()", triggers.length === 1 && batches.length === 0]);
    checks.push(["trigger() payload drops `type` into the event name", triggers[0][1] === "PRINT_JOB" && !("type" in (triggers[0][2] as object))]);
  }

  // 3 events → exactly one batch with channel/name/data per entry
  {
    const batches: any[][] = [];
    const pub = new PusherPublisher({ trigger: async () => {}, triggerBatch: async (b: any) => { batches.push(b); } }, "ch");
    await pub.publishMany([ev(1), ev(2), ev(3)]);
    checks.push(["3 events → one triggerBatch call", batches.length === 1 && batches[0].length === 3]);
    checks.push([
      "batch entries carry channel, name and data without type",
      batches[0].every((e: any) => e.channel === "ch" && e.name === "PRINT_JOB" && !("type" in e.data)) && batches[0][2].data.jobId === 3,
    ]);
  }

  // 25 events → chunks of 10, 10, 5
  {
    const batches: any[][] = [];
    const pub = new PusherPublisher({ trigger: async () => {}, triggerBatch: async (b: any) => { batches.push(b); } }, "ch");
    await pub.publishMany(Array.from({ length: 25 }, (_, i) => ev(i)));
    checks.push(["25 events → 3 batches of 10/10/5", eq(batches.map((b) => b.length), [10, 10, 5])]);
  }

  // empty → nothing
  {
    let calls = 0;
    const pub = new PusherPublisher({ trigger: async () => { calls++; }, triggerBatch: async () => { calls++; } }, "ch");
    await pub.publishMany([]);
    checks.push(["empty list makes no call", calls === 0]);
  }

  // SDK without triggerBatch → per-event trigger
  {
    const triggers: any[] = [];
    const pub = new PusherPublisher({ trigger: async (c: string, n: string, d: unknown) => { triggers.push([c, n, d]); } } as any, "ch");
    await pub.publishMany([ev(1), ev(2)]);
    checks.push(["no triggerBatch → falls back to trigger() per event", triggers.length === 2]);
  }

  // Local WS publisher broadcasts each event
  {
    const seen: any[] = [];
    const pub = new LocalWsPublisher((d) => { seen.push(d); });
    await pub.publishMany([ev(1), ev(2)]);
    checks.push(["LocalWsPublisher.publishMany broadcasts each event", seen.length === 2 && seen[1].jobId === 2]);
  }

  // Composite fans publishMany out to every member (member without publishMany → publish loop)
  {
    const seenA: any[] = [];
    const seenB: any[] = [];
    const a = new LocalWsPublisher((d) => { seenA.push(d); });
    const b = { publish: async (e: any) => { seenB.push(e); } };
    await new CompositePublisher([a, b as any]).publishMany([ev(1), ev(2)]);
    checks.push(["CompositePublisher.publishMany reaches every member", seenA.length === 2 && seenB.length === 2]);
  }

  // Batch failure → each event of the chunk is re-sent individually
  const realConsoleError = console.error;
  console.error = () => {};
  try {
    {
      const triggers: any[] = [];
      const pub = new PusherPublisher(
        {
          trigger: async (c: string, n: string, d: unknown) => { triggers.push([c, n, d]); },
          triggerBatch: async () => { throw new Error("batch boom"); },
        },
        "ch",
      );
      await pub.publishMany([ev(1), ev(2), ev(3)]);
      checks.push([
        "triggerBatch throws → trigger() called once per event with the right name",
        triggers.length === 3 && triggers.every((t) => t[0] === "ch" && t[1] === "PRINT_JOB" && !("type" in t[2])) && eq(triggers.map((t) => t[2].jobId), [1, 2, 3]),
      ]);
    }

    {
      const triggers: any[] = [];
      let threw = false;
      const pub = new PusherPublisher(
        {
          trigger: async (c: string, n: string, d: any) => {
            if (d.jobId === 2) throw new Error("event 2 too large");
            triggers.push([c, n, d]);
          },
          triggerBatch: async () => { throw new Error("batch boom"); },
        },
        "ch",
      );
      try {
        await pub.publishMany([ev(1), ev(2), ev(3)]);
      } catch {
        threw = true;
      }
      checks.push([
        "one individual send also fails → other events still sent, publishMany resolves",
        !threw && eq(triggers.map((t) => t[2].jobId), [1, 3]),
      ]);
    }

    {
      const triggers: any[] = [];
      const pub = new PusherPublisher(
        {
          trigger: async (c: string, n: string, d: unknown) => { triggers.push([c, n, d]); },
          triggerBatch: async () => {},
        },
        "ch",
      );
      await pub.publishMany([ev(1), ev(2), ev(3)]);
      checks.push(["successful batch makes no individual trigger() call", triggers.length === 0]);
    }
  } finally {
    console.error = realConsoleError;
  }

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

function eq(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

main();
