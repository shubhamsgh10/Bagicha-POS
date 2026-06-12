/**
 * metaDriver.ts — official Meta WhatsApp Cloud API driver.
 *
 * Sending reuses sendViaMeta() from whatsappService.ts. Inbound messages and
 * delivery statuses arrive via the public webhook (whatsappRoutes.ts), which
 * calls emitInbound()/emitStatusUpdate() on this driver.
 *
 * Dormant until the restaurant completes Meta Business verification — the
 * driver reports "connected" as soon as credentials are configured.
 */

import { sendViaMeta } from "../whatsappService";
import { getAutomationConfig } from "../automationStore";
import {
  DriverEvents,
  type WhatsAppDriver,
  type WaConnectionState,
  type WaSendResult,
  type WaInboundMessage,
  type WaStatusUpdate,
} from "./types";

export class MetaDriver implements WhatsAppDriver {
  readonly name = "meta" as const;

  private events = new DriverEvents();
  private state: WaConnectionState = "disconnected";

  async init(): Promise<void> {
    const config = getAutomationConfig();
    this.state = config.metaPhoneNumberId && config.metaAccessToken ? "connected" : "disconnected";
    this.events.emitConnection(this.state);
    if (this.state === "disconnected") {
      console.warn("[WhatsApp][Meta] Missing metaPhoneNumberId / metaAccessToken — driver inactive");
    }
  }

  async sendText(phone: string, text: string): Promise<WaSendResult> {
    const config = getAutomationConfig();
    if (!config.metaPhoneNumberId || !config.metaAccessToken) {
      return { success: false, error: "Meta Cloud API not configured" };
    }
    const result = await sendViaMeta(phone, text, {
      metaPhoneNumberId: config.metaPhoneNumberId,
      metaAccessToken:   config.metaAccessToken,
    });
    return { success: result.success, waMessageId: result.waMessageId, error: result.error };
  }

  /** Called by the webhook route when Meta delivers an inbound message. */
  emitInbound(m: WaInboundMessage): void { this.events.emitMessage(m); }
  /** Called by the webhook route when Meta delivers a status update. */
  emitStatusUpdate(s: WaStatusUpdate): void { this.events.emitStatus(s); }

  getState(): WaConnectionState { return this.state; }
  getQr(): string | null { return null; }

  onMessageReceived(cb: Parameters<DriverEvents["onMessageReceived"]>[0]): void { this.events.onMessageReceived(cb); }
  onStatusUpdate(cb: Parameters<DriverEvents["onStatusUpdate"]>[0]): void { this.events.onStatusUpdate(cb); }
  onConnectionChange(cb: Parameters<DriverEvents["onConnectionChange"]>[0]): void { this.events.onConnectionChange(cb); }

  async destroy(): Promise<void> {
    this.state = "disconnected";
    this.events.emitConnection(this.state);
  }

  async logout(): Promise<void> {
    await this.destroy();
  }
}
