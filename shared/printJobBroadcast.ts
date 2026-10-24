/**
 * What a PRINT_JOB realtime broadcast may carry. Pusher rejects any event over ~10 KB of data, and the
 * image-style KOT (shared/print/kotImage.ts) is tens of KB of base64 — a text ticket is 1–3 KB. An oversized
 * payload used to mean the whole broadcast failed and the job reached the printer only via the catch-up poll.
 * So a big payload is left out of the broadcast; the station that claims the job reads it from the claim
 * response instead (POST /api/print/jobs/:id/claim returns the full row — see claimAndExecute).
 */

/** Leaves headroom under Pusher's 10,240-byte limit for the other fields and the JSON envelope. */
export const MAX_BROADCAST_PAYLOAD_CHARS = 6000;

/** The payload to put on the broadcast, or undefined when it is too big to travel that way. */
export function broadcastPayload(payload: string): string | undefined {
  return payload.length <= MAX_BROADCAST_PAYLOAD_CHARS ? payload : undefined;
}
