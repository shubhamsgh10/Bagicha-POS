import { useEffect, useRef, useState } from 'react';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

const MIN_DELAY = 2_000;
const MAX_DELAY = 30_000;

export function useWebSocket(_url: string) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'Connecting' | 'Open' | 'Closed'>('Connecting');
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const delayRef = useRef(MIN_DELAY);

  useEffect(() => {
    // WebSocket requires a persistent server — not available on serverless (Vercel).
    // Only connect in local dev where the Express WS server is running.
    if (!import.meta.env.DEV) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        delayRef.current = MIN_DELAY;
        setConnectionStatus('Open');
        setSocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          setLastMessage(JSON.parse(event.data));
        } catch {}
      };

      ws.onclose = () => {
        setConnectionStatus('Closed');
        setSocket(null);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delayRef.current);
        delayRef.current = Math.min(delayRef.current * 2, MAX_DELAY);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  const sendMessage = (message: WebSocketMessage) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  return { socket, lastMessage, connectionStatus, sendMessage };
}
