/**
 * types.ts — WhatsApp driver contract.
 *
 * Two drivers implement this interface:
 *   - baileysDriver  — unofficial WhatsApp Web (QR pairing, free, ban risk)
 *   - metaDriver     — official Meta Cloud API (webhook-fed, needs verification)
 *
 * The rest of the system (queue, bot, inbox) only ever talks to this interface,
 * so switching providers is a config change, not a code change.
 */

export type WaConnectionState = "disconnected" | "connecting" | "qr_pending" | "connected";
export type WaDeliveryStatus  = "sent" | "delivered" | "read" | "failed";

export interface WaInboundMessage {
  waMessageId: string;
  phone:       string;          // normalized 91XXXXXXXXXX
  pushName?:   string;          // sender's WhatsApp display name
  body:        string;
  timestamp:   Date;
}

export interface WaStatusUpdate {
  waMessageId: string;
  status:      WaDeliveryStatus;
  error?:      string;
}

export interface WaSendResult {
  success:      boolean;
  waMessageId?: string;
  error?:       string;
}

export interface WhatsAppDriver {
  readonly name: "baileys" | "meta";
  init(): Promise<void>;                       // connect / start session
  destroy(): Promise<void>;                    // graceful shutdown (keeps session)
  logout(): Promise<void>;                     // wipe session (Baileys: delete auth dir)
  sendText(phone: string, text: string): Promise<WaSendResult>;
  getState(): WaConnectionState;
  getQr(): string | null;                      // raw QR string (Baileys only)
  onMessageReceived(cb: (m: WaInboundMessage) => void): void;
  onStatusUpdate(cb: (s: WaStatusUpdate) => void): void;
  onConnectionChange(cb: (state: WaConnectionState) => void): void;
}

/** Shared listener plumbing so each driver doesn't reimplement it. */
export class DriverEvents {
  private messageListeners: Array<(m: WaInboundMessage) => void> = [];
  private statusListeners:  Array<(s: WaStatusUpdate) => void> = [];
  private connListeners:    Array<(state: WaConnectionState) => void> = [];

  onMessageReceived(cb: (m: WaInboundMessage) => void): void { this.messageListeners.push(cb); }
  onStatusUpdate(cb: (s: WaStatusUpdate) => void): void      { this.statusListeners.push(cb); }
  onConnectionChange(cb: (state: WaConnectionState) => void): void { this.connListeners.push(cb); }

  emitMessage(m: WaInboundMessage): void {
    for (const cb of this.messageListeners) {
      try { cb(m); } catch (err) { console.error("[WhatsApp] message listener error:", err); }
    }
  }
  emitStatus(s: WaStatusUpdate): void {
    for (const cb of this.statusListeners) {
      try { cb(s); } catch (err) { console.error("[WhatsApp] status listener error:", err); }
    }
  }
  emitConnection(state: WaConnectionState): void {
    for (const cb of this.connListeners) {
      try { cb(state); } catch (err) { console.error("[WhatsApp] connection listener error:", err); }
    }
  }
}

/** Normalize Indian phone number to 91XXXXXXXXXX (E.164 without +). */
export function normalizeWaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  // 11 digits with a leading trunk "0" (e.g. 09876543210) — strip it before prepending.
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function isValidWaPhone(phone: string): boolean {
  return normalizeWaPhone(phone).length === 12;
}
