import { useEffect, useRef, useState, type ReactNode } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  RealtimeContext,
  type RealtimeMessage,
  type ConnectionStatus,
} from "@/hooks/realtimeContext";
import { isOrderEvent, isOrderDerivedKey } from "@shared/realtimeInvalidation";

const MIN_DELAY = 2_000;
const MAX_DELAY = 30_000;

// Order/table/KOT events are coalesced: the first one schedules a refresh, any arriving within
// this window ride along, so a burst (a save publishes several) costs one refetch per query.
const ORDER_REFRESH_DELAY_MS = 1_500;
let orderRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// Shop-PC local mode (the server answers reads from its own copy, see server/local/*). Probed once
// on mount via GET /api/local/status; a cloud deployment answers 404 and nothing below runs.
// In local mode a cloud change (a phone's order, a menu edit) only shows up after the local server
// has pulled it, so each such event first asks the local server to sync, and the refetch waits for it.
let localMode = false;
let pendingLocalSync: Promise<void> | null = null;

async function probeLocalMode() {
  try {
    const res = await fetch(apiUrl("/api/local/status"), { credentials: "include" });
    if (!res.ok) return;
    const body = await res.json();
    localMode = body?.localMode === true;
  } catch {
    /* cloud mode / offline: stay in cloud mode */
  }
}

function syncLocalNow(): Promise<void> {
  if (!pendingLocalSync) {
    pendingLocalSync = fetch(apiUrl("/api/local/sync-now"), {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "fetch" },
    })
      .then(() => undefined, () => undefined) // never blocks the refresh
      .finally(() => { pendingLocalSync = null; });
  }
  return pendingLocalSync;
}

function scheduleOrderRefresh() {
  if (orderRefreshTimer) return;
  orderRefreshTimer = setTimeout(() => {
    orderRefreshTimer = null;
    // Only queries currently on screen refetch; the rest are just marked stale.
    const refresh = () => queryClient.invalidateQueries({ predicate: (q) => isOrderDerivedKey(q.queryKey) });
    if (localMode && pendingLocalSync) pendingLocalSync.then(refresh, refresh);
    else refresh();
  }, ORDER_REFRESH_DELAY_MS);
}

// After a reconnect, events sent while we were offline are lost — refresh everything on screen
// once. Not on the first connect of the page (the data was just loaded).
let hasConnectedOnce = false;
function onRealtimeConnected() {
  if (hasConnectedOnce) {
    if (localMode) void syncLocalNow().then(() => queryClient.invalidateQueries());
    else queryClient.invalidateQueries();
  }
  hasConnectedOnce = true;
}

// Synchronous listeners (RealtimeContextValue.subscribe) — they see every message, unlike the
// single lastMessage state slot, which collapses events that arrive in the same render.
const listeners = new Set<(m: RealtimeMessage) => void>();
function subscribe(listener: (m: RealtimeMessage) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function handleMessage(msg: RealtimeMessage, setLastMessage: (m: RealtimeMessage | null) => void) {
  if (localMode && (isOrderEvent(msg.type) || msg.type === "SYNC_NUDGE")) void syncLocalNow();
  if (isOrderEvent(msg.type)) scheduleOrderRefresh(); // and still delivered to listeners below
  Array.from(listeners).forEach((l) => {
    try { l(msg); } catch (err) { console.error("[realtime] listener failed:", err); }
  });

  if (msg.type === "SYNC_NUDGE") {
    // Published by the cloud after a menu / category / table / settings / account write. Only the
    // shop PC's local copy cares: once it has pulled, the screens re-read.
    if (localMode) {
      void syncLocalNow().then(() => {
        for (const root of ["/api/categories", "/api/menu", "/api/tables", "/api/settings"]) {
          queryClient.invalidateQueries({ queryKey: [root] });
        }
      });
    }
  } else if (msg.type === "CACHE_BUST") {
    queryClient.invalidateQueries();
  } else if (msg.type === "MENU_UPDATE") {
    // Category/menu-item CRUD (incl. drag-reorder) has no other freshness signal for an
    // already-open session — no polling on these queries, refetchOnWindowFocus is off,
    // and staleTime (30s) has nothing to re-check it once elapsed once mounted. Scoped
    // invalidation (not a blanket CACHE_BUST) so it doesn't also refetch orders/tables
    // mid-service.
    queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    queryClient.invalidateQueries({ queryKey: ["/api/menu"] });
  } else {
    setLastMessage(msg);
  }
}

/**
 * Owns the ONE realtime connection for the whole app (Pusher or local WS).
 * Previously every useRealtime() call site opened its own independent Pusher
 * connection + auth handshake (9 call sites = 9 simultaneous connections from
 * a single page). Under connection contention some would succeed while others
 * silently lagged or failed — e.g. Tables' own connection would come up fine
 * while usePrintJobBridge's separate connection didn't, so print jobs required
 * a reload to "retry" via a fresh mount even though the user was logged in and
 * Tables was already showing live data. Mounted once at the app root
 * (main.tsx) so every consumer shares this single connection's state.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Connecting");
  const { isAuthenticated } = useAuth();

  // Once per page load: is this the shop PC's local server? (404 on the cloud = no.)
  useEffect(() => { void probeLocalMode(); }, []);

  const pusherKey = import.meta.env.VITE_PUSHER_KEY as string | undefined;
  const pusherCluster = (import.meta.env.VITE_PUSHER_CLUSTER as string | undefined) || "ap2";
  const pusherChannel = (import.meta.env.VITE_PUSHER_CHANNEL as string | undefined) || "private-bagicha-pos";

  // Pusher (production / cross-origin clients)
  useEffect(() => {
    // Private channels need a valid session for the auth handshake. useAuth() is
    // driven by React Query — isAuthenticated flips to true reactively the instant
    // login succeeds, which re-runs this effect (dependency below) and retries the
    // subscription. Without this gate, mounting before login fails the ONE
    // subscription and nothing ever retries it.
    if (!pusherKey || !isAuthenticated) return;

    let disposed = false;
    let pusher: any;
    let channel: any;

    const events = [
      "TABLE_UPDATE",
      "NEW_ORDER",
      "ORDER_UPDATE",
      "KOT_UPDATE",
      "NEW_DELIVERY_ORDER",
      "ATTENDANCE_UPDATE",
      "CACHE_BUST",
      "MENU_UPDATE",
      "SYNC_NUDGE",
      "WA_MESSAGE",
      "WA_STATUS",
      "WA_CONVERSATION_UPDATE",
      "WA_CONNECTION",
      "PRINT_JOB",
    ];

    (async () => {
      try {
        const Pusher = (await import("pusher-js")).default;
        if (disposed) return;
        setConnectionStatus("Connecting");
        // Private/presence channels require a server-authorized handshake — the
        // customHandler POSTs to /api/pusher/auth with the session cookie. Without
        // this, pusher-js falls back to its own default auth endpoint/transport,
        // which doesn't match this app's route and fails the subscription outright.
        const isPrivate = pusherChannel.startsWith("private-") || pusherChannel.startsWith("presence-");
        pusher = new Pusher(pusherKey, {
          cluster: pusherCluster,
          forceTLS: true,
          ...(isPrivate
            ? {
                channelAuthorization: {
                  transport: "ajax" as const,
                  endpoint: "/api/pusher/auth",
                  customHandler: async (
                    params: { socketId: string; channelName: string },
                    callback: (error: Error | null, authData: any) => void,
                  ) => {
                    try {
                      const res = await apiRequest("POST", "/api/pusher/auth", {
                        socket_id: params.socketId,
                        channel_name: params.channelName,
                      });
                      callback(null, await res.json());
                    } catch (e) {
                      callback(e as Error, null);
                    }
                  },
                },
              }
            : {}),
        });
        channel = pusher.subscribe(pusherChannel);
        // A failed private-channel auth (a 503 while settings load, a cold-start timeout) left the
        // channel unsubscribed for good while the CONNECTION still read "Open", so no events and no
        // reconnect catch-up. Retry with backoff; a recovered subscription refreshes what's on screen.
        let subRetryMs = 2_000;
        let subFailed = false;
        channel.bind("pusher:subscription_error", () => {
          if (disposed) return;
          subFailed = true;
          setConnectionStatus("Connecting");
          setTimeout(() => { if (!disposed) channel.subscribe(); }, subRetryMs);
          subRetryMs = Math.min(subRetryMs * 2, MAX_DELAY);
        });
        channel.bind("pusher:subscription_succeeded", () => {
          if (disposed) return;
          subRetryMs = 2_000;
          setConnectionStatus("Open");
          if (subFailed) { subFailed = false; queryClient.invalidateQueries(); }
        });

        const handlers = events.map((eventName) => {
          const fn = (data: unknown) => {
            const msg = {
              type: eventName,
              ...(typeof data === "object" && data ? data : {}),
            } as RealtimeMessage;
            handleMessage(msg, setLastMessage);
          };
          channel.bind(eventName, fn);
          return { eventName, fn };
        });

        pusher.connection.bind("connected", () => {
          if (disposed) return;
          setConnectionStatus("Open");
          onRealtimeConnected();
        });
        pusher.connection.bind("disconnected", () => !disposed && setConnectionStatus("Closed"));

        return () => {
          handlers.forEach(({ eventName, fn }) => channel.unbind(eventName, fn));
          pusher.disconnect();
        };
      } catch {
        if (!disposed) setConnectionStatus("Closed");
      }
    })();

    return () => {
      disposed = true;
      try {
        pusher?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [pusherKey, pusherCluster, pusherChannel, isAuthenticated]);

  // Local WebSocket (dev server co-located with Express)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const delayRef = useRef(MIN_DELAY);

  useEffect(() => {
    // Pusher deployments (Vercel) never use the local WS. Everywhere else —
    // dev AND production LAN builds — Express serves /ws on the same host.
    if (pusherKey) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        delayRef.current = MIN_DELAY;
        setConnectionStatus("Open");
        setSocket(ws);
        onRealtimeConnected();
      };

      ws.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data) as RealtimeMessage, setLastMessage);
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        setConnectionStatus("Closed");
        setSocket(null);
        reconnectTimeoutRef.current = setTimeout(connect, delayRef.current);
        delayRef.current = Math.min(delayRef.current * 2, MAX_DELAY);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => clearTimeout(reconnectTimeoutRef.current);
  }, [pusherKey]);

  const sendMessage = (message: RealtimeMessage) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  return (
    <RealtimeContext.Provider value={{ socket, lastMessage, connectionStatus, sendMessage, subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
}
