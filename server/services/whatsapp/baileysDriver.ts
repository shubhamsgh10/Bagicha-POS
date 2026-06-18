/**
 * baileysDriver.ts — unofficial WhatsApp Web driver via @whiskeysockets/baileys.
 *
 * ALL Baileys imports stay inside this file so a library upgrade touches one file.
 * The package version is pinned exactly in package.json — Baileys breaks between
 * minors; do not add a caret.
 *
 * Session auth is persisted to ./baileys-auth (gitignored, many small files).
 * On loggedOut the auth dir is wiped and the driver returns to qr_pending
 * instead of crash-looping.
 */

import fs from "fs";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import {
  DriverEvents,
  normalizeWaPhone,
  isValidWaPhone,
  type WhatsAppDriver,
  type WaConnectionState,
  type WaSendResult,
  type WaDeliveryStatus,
} from "./types";
import { dataPath } from "../../dataDir";

const AUTH_DIR = dataPath("baileys-auth");
const MAX_RECONNECT_DELAY_MS = 60_000;

/** Baileys ack codes (proto.WebMessageInfo.Status) → our statuses. */
function ackToStatus(ack: number): WaDeliveryStatus | null {
  switch (ack) {
    case 2: return "sent";       // SERVER_ACK
    case 3: return "delivered";  // DELIVERY_ACK
    case 4: return "read";       // READ
    case 5: return "read";       // PLAYED (voice notes) — treat as read
    default: return null;        // 0 ERROR / 1 PENDING — ignore
  }
}

export class BaileysDriver implements WhatsAppDriver {
  readonly name = "baileys" as const;

  private events = new DriverEvents();
  private socket: WASocket | null = null;
  private state: WaConnectionState = "disconnected";
  private qr: string | null = null;
  private reconnectDelay = 2_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  async init(): Promise<void> {
    this.destroyed = false;
    await this.connect();
  }

  private setState(state: WaConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.emitConnection(state);
  }

  private async connect(): Promise<void> {
    if (this.destroyed) return;
    this.setState("connecting");

    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as any }));

    const socket = makeWASocket({
      auth: authState,
      version,
      logger: pino({ level: "silent" }) as any,
      // We render the QR ourselves in the Setup tab
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false, // keep the phone's own notifications working
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qr = qr;
        this.setState("qr_pending");
      }

      if (connection === "open") {
        this.qr = null;
        this.reconnectDelay = 2_000;
        this.setState("connected");
        console.log("[WhatsApp][Baileys] Connected");
      }

      if (connection === "close") {
        this.qr = null;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.warn("[WhatsApp][Baileys] Logged out — wiping session, QR re-pair required");
          this.wipeAuthDir();
          this.setState("disconnected");
          // Reconnect fresh so a new QR is issued
          this.scheduleReconnect();
        } else if (!this.destroyed) {
          this.setState("disconnected");
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return; // skip history sync batches
      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;

          // WhatsApp increasingly routes private chats through anonymized
          // @lid JIDs; the real phone JID then lives in an "alt" field
          // (named differently across Baileys releases — check them all).
          const rawJid = msg.key.remoteJid ?? "";
          let phoneJid = rawJid;
          if (rawJid.endsWith("@lid")) {
            const k = msg.key as any;
            phoneJid =
              k.remoteJidAlt ??
              k.senderPn ??
              (msg as any).senderPn ??
              (msg as any).participantPn ??
              "";
          }

          // Direct chats only — skip groups (@g.us), broadcasts, newsletters
          if (!phoneJid.endsWith("@s.whatsapp.net")) {
            // Status updates / groups / newsletters / broadcasts arrive constantly —
            // ignore them silently. Only log a genuinely unexpected JID (e.g. a LID
            // chat we couldn't resolve a phone for) so the logs stay useful.
            const noisy = /@(g\.us|broadcast|newsletter)$/.test(rawJid);
            if (!noisy) {
              console.log(`[WhatsApp][Baileys] Skipping inbound from unsupported JID: ${rawJid}` +
                (rawJid.endsWith("@lid") ? " (LID chat with no phone alt — cannot resolve sender)" : ""));
            }
            continue;
          }

          const body =
            msg.message.conversation ??
            msg.message.extendedTextMessage?.text ??
            "";
          if (!body.trim()) continue; // ignore media-only / reactions for now

          const phone = normalizeWaPhone(phoneJid.split("@")[0]);
          console.log(`[WhatsApp][Baileys] Inbound from ${phone}: ${body.slice(0, 40)}`);
          this.events.emitMessage({
            waMessageId: msg.key.id ?? "",
            phone,
            pushName:    msg.pushName ?? undefined,
            body:        body.trim(),
            timestamp:   new Date(Number(msg.messageTimestamp) * 1000 || Date.now()),
          });
        } catch (err) {
          console.error("[WhatsApp][Baileys] inbound parse error:", err);
        }
      }
    });

    socket.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        try {
          if (!u.key?.fromMe || !u.key.id) continue;
          const ack = (u.update as any)?.status;
          if (typeof ack !== "number") continue;
          const status = ackToStatus(ack);
          if (status) this.events.emitStatus({ waMessageId: u.key.id, status });
        } catch (err) {
          console.error("[WhatsApp][Baileys] status parse error:", err);
        }
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => {
        console.error("[WhatsApp][Baileys] reconnect failed:", err);
        this.scheduleReconnect();
      });
    }, delay);
    console.log(`[WhatsApp][Baileys] Reconnecting in ${Math.round(delay / 1000)}s…`);
  }

  private wipeAuthDir(): void {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch (err) {
      console.error("[WhatsApp][Baileys] failed to wipe auth dir:", err);
    }
  }

  async sendText(phone: string, text: string): Promise<WaSendResult> {
    if (this.state !== "connected" || !this.socket) {
      return { success: false, error: "WhatsApp not connected" };
    }
    if (!isValidWaPhone(phone)) {
      return { success: false, error: "Invalid phone number" };
    }
    try {
      const jid = `${normalizeWaPhone(phone)}@s.whatsapp.net`;
      const sent = await this.socket.sendMessage(jid, { text });
      return { success: true, waMessageId: sent?.key?.id ?? undefined };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Send failed" };
    }
  }

  getState(): WaConnectionState { return this.state; }
  getQr(): string | null { return this.qr; }

  onMessageReceived(cb: Parameters<DriverEvents["onMessageReceived"]>[0]): void { this.events.onMessageReceived(cb); }
  onStatusUpdate(cb: Parameters<DriverEvents["onStatusUpdate"]>[0]): void { this.events.onStatusUpdate(cb); }
  onConnectionChange(cb: Parameters<DriverEvents["onConnectionChange"]>[0]): void { this.events.onConnectionChange(cb); }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.socket?.end(undefined); } catch {}
    this.socket = null;
    this.setState("disconnected");
  }

  /** Unpair: close socket AND wipe the saved session. */
  async logout(): Promise<void> {
    try { await this.socket?.logout(); } catch {}
    await this.destroy();
    this.wipeAuthDir();
  }
}
