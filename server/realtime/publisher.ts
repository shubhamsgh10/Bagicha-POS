export type RealtimeEvent = Record<string, unknown> & { type: string };

export interface RealtimePublisher {
  publish(event: RealtimeEvent): Promise<void>;
  /**
   * Optional batch path — one network call for many events. Callers use publishRealtimeMany(),
   * never this directly; a publisher without it is driven through publish() per event.
   */
  publishMany?(events: RealtimeEvent[]): Promise<void>;
}

/** In-process WebSocket broadcast (local dev). */
export class LocalWsPublisher implements RealtimePublisher {
  constructor(private broadcast: (data: RealtimeEvent) => void) {}

  async publish(event: RealtimeEvent): Promise<void> {
    this.broadcast(event);
  }

  async publishMany(events: RealtimeEvent[]): Promise<void> {
    for (const event of events) this.broadcast(event);
  }
}

interface PusherServer {
  trigger: (channel: string, event: string, data: unknown) => Promise<unknown>;
  triggerBatch?: (batch: Array<{ channel: string; name: string; data: unknown }>) => Promise<unknown>;
  authorizeChannel?: (socketId: string, channel: string) => unknown;
}

/** Pusher's HTTP API accepts at most 10 events per triggerBatch call. */
const PUSHER_BATCH_LIMIT = 10;

/** Pusher Channels — works on Vercel + browser + Electron. */
export class PusherPublisher implements RealtimePublisher {
  private pusher: PusherServer;
  private channel: string;

  constructor(pusher: PusherServer, channel: string) {
    this.pusher = pusher;
    this.channel = channel;
  }

  async publish(event: RealtimeEvent): Promise<void> {
    const { type, ...data } = event;
    await this.pusher.trigger(this.channel, type, data);
  }

  async publishMany(events: RealtimeEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (events.length === 1 || !this.pusher.triggerBatch) {
      await Promise.all(events.map((e) => this.publish(e)));
      return;
    }
    for (let i = 0; i < events.length; i += PUSHER_BATCH_LIMIT) {
      const chunk = events
        .slice(i, i + PUSHER_BATCH_LIMIT)
        .map(({ type, ...data }) => ({ channel: this.channel, name: type, data }));
      try {
        await this.pusher.triggerBatch(chunk);
      } catch (err) {
        // One bad event / failed call must not drop the broadcast for every other event in the
        // chunk (e.g. other routed printers in the same tap) — retry them one by one.
        console.error("[realtime] triggerBatch failed, retrying events individually:", err);
        await Promise.all(
          events.slice(i, i + PUSHER_BATCH_LIMIT).map((e) =>
            this.publish(e).catch((eventErr) => {
              console.error(`[realtime] individual publish failed (${e.type}):`, eventErr);
            }),
          ),
        );
      }
    }
  }
}

// Reference to the raw Pusher server client so the /api/pusher/auth route can
// authorize private-channel subscriptions after checking the session.
let pusherServer: PusherServer | null = null;

export function authorizePusherChannel(socketId: string, channel: string): unknown | null {
  if (!pusherServer?.authorizeChannel) return null;
  return pusherServer.authorizeChannel(socketId, channel);
}

class NoopPublisher implements RealtimePublisher {
  async publish(): Promise<void> {}
}

export class CompositePublisher implements RealtimePublisher {
  constructor(private publishers: RealtimePublisher[]) {}

  async publish(event: RealtimeEvent): Promise<void> {
    await Promise.all(this.publishers.map((p) => p.publish(event)));
  }

  async publishMany(events: RealtimeEvent[]): Promise<void> {
    await Promise.all(
      this.publishers.map((p) =>
        p.publishMany ? p.publishMany(events) : Promise.all(events.map((e) => p.publish(e))).then(() => undefined),
      ),
    );
  }
}

let publisher: RealtimePublisher = new NoopPublisher();

export function setRealtimePublisher(next: RealtimePublisher): void {
  publisher = next;
}

export function getRealtimePublisher(): RealtimePublisher {
  return publisher;
}

export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  try {
    await publisher.publish(event);
  } catch (err) {
    console.error("[realtime] publish failed:", err);
  }
}

/** Batch variant of publishRealtime — one Pusher call for many events. Never throws. */
export async function publishRealtimeMany(events: RealtimeEvent[]): Promise<void> {
  try {
    if (publisher.publishMany) {
      await publisher.publishMany(events);
    } else {
      await Promise.all(events.map((e) => publisher.publish(e)));
    }
  } catch (err) {
    console.error("[realtime] publishMany failed:", err);
  }
}

export async function createRealtimePublisher(
  localBroadcast?: (data: RealtimeEvent) => void,
): Promise<RealtimePublisher> {
  const publishers: RealtimePublisher[] = [];
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER || "ap2";
  const channel = process.env.PUSHER_CHANNEL || "private-bagicha-pos";

  if (appId && key && secret) {
    try {
      const Pusher = (await import("pusher")).default;
      const pusher = new Pusher({ appId, key, secret, cluster, useTLS: true });
      pusherServer = pusher as unknown as PusherServer;
      console.log(`[realtime] Pusher enabled (channel: ${channel})`);
      publishers.push(new PusherPublisher(pusher, channel));
    } catch (err) {
      console.error("[realtime] Pusher init failed:", err);
    }
  }

  if (localBroadcast) {
    console.log("[realtime] Local WebSocket broadcast enabled");
    publishers.push(new LocalWsPublisher(localBroadcast));
  }

  if (publishers.length === 0) {
    console.warn("[realtime] No publisher configured — live updates disabled");
    return new NoopPublisher();
  }
  if (publishers.length === 1) return publishers[0];
  return new CompositePublisher(publishers);
}
