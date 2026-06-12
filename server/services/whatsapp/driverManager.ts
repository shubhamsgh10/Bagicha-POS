/**
 * driverManager.ts — owns the single active WhatsApp driver instance.
 *
 * IMPORTANT: only the persistent Express process (server/index.ts) may call
 * initWhatsAppDriver(). Never import this from a serverless entry point —
 * Baileys holds a long-lived socket and an on-disk session.
 */

import { BaileysDriver } from "./baileysDriver";
import { MetaDriver } from "./metaDriver";
import { getAutomationConfig, saveAutomationConfig } from "../automationStore";
import { publishRealtime } from "../../realtime/publisher";
import { handleInbound } from "./inboundService";
import { handleStatusUpdate } from "./deliveryService";
import type { WhatsAppDriver, WaConnectionState } from "./types";

let driver: WhatsAppDriver | null = null;

function wireDriver(d: WhatsAppDriver): void {
  d.onMessageReceived((msg) => {
    handleInbound(msg).catch(err => console.error("[WhatsApp] inbound handler error:", err));
  });
  d.onStatusUpdate((update) => {
    handleStatusUpdate(update).catch(err => console.error("[WhatsApp] status handler error:", err));
  });
  d.onConnectionChange((state: WaConnectionState) => {
    void publishRealtime({ type: "WA_CONNECTION", driver: d.name, state });
  });
}

function createDriver(name: "baileys" | "meta"): WhatsAppDriver {
  return name === "baileys" ? new BaileysDriver() : new MetaDriver();
}

/** Start the configured driver (no-op when whatsappDriver = "none"). */
export async function initWhatsAppDriver(): Promise<void> {
  const config = getAutomationConfig();
  if (config.whatsappDriver === "none") {
    console.log("[WhatsApp] Driver disabled (whatsappDriver = none)");
    return;
  }
  await startDriver(config.whatsappDriver);
}

async function startDriver(name: "baileys" | "meta"): Promise<void> {
  if (driver) {
    await driver.destroy().catch(() => {});
    driver = null;
  }
  const d = createDriver(name);
  wireDriver(d);
  driver = d;
  console.log(`[WhatsApp] Starting ${name} driver…`);
  await d.init();
}

/** Switch driver at runtime and persist the choice. */
export async function switchDriver(name: "baileys" | "meta" | "none"): Promise<void> {
  saveAutomationConfig({ whatsappDriver: name });
  if (name === "none") {
    if (driver) {
      await driver.destroy().catch(() => {});
      driver = null;
    }
    void publishRealtime({ type: "WA_CONNECTION", driver: "none", state: "disconnected" });
    return;
  }
  await startDriver(name);
}

/** Re-init the current driver (used by the Connect button after a logout). */
export async function reconnectDriver(): Promise<void> {
  const config = getAutomationConfig();
  if (config.whatsappDriver === "none") throw new Error("No WhatsApp driver selected");
  await startDriver(config.whatsappDriver);
}

/** Unpair / wipe session for the active driver. */
export async function logoutDriver(): Promise<void> {
  if (!driver) return;
  await driver.logout();
  void publishRealtime({ type: "WA_CONNECTION", driver: driver.name, state: "disconnected" });
}

export function getDriver(): WhatsAppDriver | null {
  return driver;
}

export function getDriverStatus(): {
  driver: "baileys" | "meta" | "none";
  state: WaConnectionState;
  qr: string | null;
} {
  const config = getAutomationConfig();
  if (!driver) return { driver: config.whatsappDriver, state: "disconnected", qr: null };
  return { driver: driver.name, state: driver.getState(), qr: driver.getQr() };
}
