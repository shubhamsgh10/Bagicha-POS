import { useEffect, useRef, useState, type ReactNode } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  RealtimeContext,
  type RealtimeMessage,
  type ConnectionStatus,
} from "@/hooks/realtimeContext";

const MIN_DELAY = 2_000;
const MAX_DELAY = 30_000;

function handleMessage(msg: RealtimeMessage, setLastMessage: (m: RealtimeMessage | null) => void) {
  if (msg.type === "CACHE_BUST") {
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

        pusher.connection.bind("connected", () => !disposed && setConnectionStatus("Open"));
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
    <RealtimeContext.Provider value={{ socket, lastMessage, connectionStatus, sendMessage }}>
      {children}
    </RealtimeContext.Provider>
  );
}
