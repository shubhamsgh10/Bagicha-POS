import { createContext } from "react";

export interface RealtimeMessage {
  type: string;
  [key: string]: unknown;
}

export type ConnectionStatus = "Connecting" | "Open" | "Closed";

export interface RealtimeContextValue {
  socket: WebSocket | null;
  lastMessage: RealtimeMessage | null;
  connectionStatus: ConnectionStatus;
  sendMessage: (message: RealtimeMessage) => void;
  /**
   * Every message, delivered synchronously as it arrives. `lastMessage` is one React state slot:
   * two events in the same render (a KOT tap on two routed printers sends two PRINT_JOBs back to
   * back) left effects seeing only the second — the first job waited for the catch-up poll.
   * Use this for anything that must see EVERY event. Returns the unsubscribe function.
   */
  subscribe: (listener: (message: RealtimeMessage) => void) => () => void;
}

// Isolated in its own file — this object's identity must never be duplicated.
// Previously it lived in the same module as the RealtimeProvider component and
// the useRealtime hook; a file that mixes a component export with non-component
// exports is a known Vite/React-Refresh gotcha that can cause the module to be
// re-evaluated as two separate instances (each with its own createContext()
// result), so a <Provider> from one copy is invisible to useContext() calls
// resolving to the other. A pure, component-free module has no such ambiguity.
export const RealtimeContext = createContext<RealtimeContextValue | null>(null);
