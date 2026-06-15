import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";

export interface RealtimeMessage {
  type: string;
  [key: string]: unknown;
}

const MIN_DELAY = 2_000;
const MAX_DELAY = 30_000;

type ConnectionStatus = "Connecting" | "Open" | "Closed";

function handleMessage(msg: RealtimeMessage, setLastMessage: (m: RealtimeMessage | null) => void) {
  if (msg.type === "CACHE_BUST") {
    queryClient.invalidateQueries();
  } else {
    setLastMessage(msg);
  }
}

/** Realtime updates: Pusher when VITE_PUSHER_KEY is set; local WS in dev when UI is served with API. */
export function useRealtime(_url?: string) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Connecting");

  const pusherKey = import.meta.env.VITE_PUSHER_KEY as string | undefined;
  const pusherCluster = (import.meta.env.VITE_PUSHER_CLUSTER as string | undefined) || "ap2";
  const pusherChannel = (import.meta.env.VITE_PUSHER_CHANNEL as string | undefined) || "bagicha-pos";

  // Pusher (production / cross-origin clients)
  useEffect(() => {
    if (!pusherKey) return;

    let disposed = false;
    let pusher: any;
    let channel: any;

    const events = [
      "TABLE_UPDATE",
      "NEW_ORDER",
      "ORDER_UPDATE",
      "KOT_UPDATE",
      "NEW_DELIVERY_ORDER",
      "CACHE_BUST",
      "WA_MESSAGE",
      "WA_STATUS",
      "WA_CONVERSATION_UPDATE",
      "WA_CONNECTION",
    ];

    (async () => {
      try {
        const Pusher = (await import("pusher-js")).default;
        if (disposed) return;
        setConnectionStatus("Connecting");
        pusher = new Pusher(pusherKey, { cluster: pusherCluster, forceTLS: true });
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
  }, [pusherKey, pusherCluster, pusherChannel]);

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

  return { socket, lastMessage, connectionStatus, sendMessage };
}
