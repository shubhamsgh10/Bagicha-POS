/**
 * A fake print station — stands in for the Electron host / RawBT phone so the delivery chain
 * (PRINT_JOB broadcast → claim → "print" → ack) can be exercised with NO physical printer.
 * It subscribes to ONE Pusher channel (the bench channel) and only touches jobs whose
 * printerId starts with `printerIdPrefix` (default "bench-"), so it can never claim a real job.
 * Manual-only tooling; not part of test:pure.
 */
import PusherJs from "pusher-js";
import PusherServer from "pusher";

// pusher-js's node build is a CJS bundle; under this ESM project (pusher-js 8.5.0) the default
// import is the module object `{ Pusher }`, not the constructor. Unwrap it.
const Pusher = ((PusherJs as any).Pusher ?? (PusherJs as any).default ?? PusherJs) as typeof PusherJs;

export interface StationEvent {
  jobId: number;
  orderId: number;
  jobType: string;
  printerId: string;
  tEvent: number;
  tClaim: number;
  tAck: number;
}

export interface VirtualStation {
  events: Map<number, StationEvent>;
  /** Resolves true when every job id has been acked, false on timeout. */
  waitForJobs(jobIds: number[], timeoutMs: number): Promise<boolean>;
  stop(): void;
}

export async function startVirtualStation(opts: {
  baseUrl: string;
  channel: string;
  printerIdPrefix?: string;
  headers?: Record<string, string>;
  onEvent?: (e: StationEvent) => void;
}): Promise<VirtualStation> {
  const { PUSHER_APP_ID: appId, PUSHER_KEY: key, PUSHER_SECRET: secret } = process.env;
  const cluster = process.env.PUSHER_CLUSTER || "ap2";
  if (!appId || !key || !secret) {
    throw new Error("PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET are required for the virtual station");
  }
  const prefix = opts.printerIdPrefix ?? "bench-";
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };

  // Authorise the private channel locally with the same credentials the server uses.
  const signer = new PusherServer({ appId, key, secret, cluster, useTLS: true });
  const client = new Pusher(key, {
    cluster,
    channelAuthorization: {
      customHandler: (
        { socketId, channelName }: { socketId: string; channelName: string },
        callback: (err: Error | null, data: any) => void,
      ) => {
        try {
          callback(null, signer.authorizeChannel(socketId, channelName) as any);
        } catch (err) {
          callback(err as Error, null as any);
        }
      },
    } as any,
  });

  const events = new Map<number, StationEvent>();
  const channel = client.subscribe(opts.channel);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Pusher subscription to ${opts.channel} timed out after 10s (Pusher unreachable?)`)),
      10_000,
    );
    channel.bind("pusher:subscription_succeeded", () => {
      clearTimeout(timer);
      resolve();
    });
    channel.bind("pusher:subscription_error", (e: unknown) => {
      clearTimeout(timer);
      reject(new Error(`subscription failed: ${JSON.stringify(e)}`));
    });
  }).catch((err) => {
    client.disconnect(); // don't keep a dangling socket alive after a failed start
    throw err;
  });

  channel.bind("PRINT_JOB", async (data: any) => {
    if (!String(data?.printerId ?? "").startsWith(prefix)) return;
    const tEvent = performance.now();
    try {
      const claimRes = await fetch(`${opts.baseUrl}/api/print/jobs/${data.jobId}/claim`, { method: "POST", headers });
      const claim: any = await claimRes.json();
      const tClaim = performance.now();
      if (!claim?.claimed) return; // someone else owns it — never ack
      // "Print" is a no-op: there is no printer.
      await fetch(`${opts.baseUrl}/api/print/ack`, {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId: data.orderId, type: data.jobType, jobId: data.jobId }),
      });
      const tAck = performance.now();
      const evt: StationEvent = {
        jobId: data.jobId,
        orderId: data.orderId,
        jobType: data.jobType,
        printerId: data.printerId,
        tEvent,
        tClaim,
        tAck,
      };
      events.set(data.jobId, evt);
      opts.onEvent?.(evt);
    } catch (err) {
      console.error("[virtual-station] failed handling job", data?.jobId, err);
    }
  });

  return {
    events,
    async waitForJobs(jobIds, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (jobIds.every((id) => events.has(id))) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return jobIds.every((id) => events.has(id));
    },
    stop() {
      client.disconnect();
    },
  };
}
