import { useContext } from "react";
import { RealtimeContext, type RealtimeContextValue, type RealtimeMessage } from "@/hooks/realtimeContext";

export type { RealtimeMessage };

/** Reads the shared realtime connection. Must be used under <RealtimeProvider> (main.tsx). */
export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime() must be used within <RealtimeProvider>");
  return ctx;
}
