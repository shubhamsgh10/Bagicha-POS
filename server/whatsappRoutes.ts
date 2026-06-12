/**
 * whatsappRoutes.ts
 *
 * WhatsApp driver control, agent inbox (conversations), and the public Meta
 * Cloud API webhook. Mounted from server/routes.ts via registerWhatsAppRoutes()
 * / registerPublicWhatsAppRoutes() — same pattern as growthRoutes.ts.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { logAudit } from "./services/auditService";
import { getAutomationConfig } from "./services/automationStore";
import { publishRealtime } from "./realtime/publisher";
import {
  getDriver,
  getDriverStatus,
  switchDriver,
  reconnectDriver,
  logoutDriver,
} from "./services/whatsapp/driverManager";
import {
  listConversations,
  getConversation,
  getConversationMessages,
  recordMessage,
  markConversationRead,
  setBotActive,
  setAgentReplied,
  getUnreadTotal,
} from "./services/whatsapp/conversationStore";
import { MetaDriver } from "./services/whatsapp/metaDriver";
import { normalizeWaPhone } from "./services/whatsapp/types";

// ── Auth middleware (local copies — avoids circular import with routes.ts) ────

function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

// ── Authenticated routes ──────────────────────────────────────────────────────

export function registerWhatsAppRoutes(app: Express): void {
  // Driver status + QR (rendered server-side as a data URL)
  app.get("/api/whatsapp/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const status = getDriverStatus();
      let qrDataUrl: string | null = null;
      if (status.qr) {
        qrDataUrl = await QRCode.toDataURL(status.qr, { width: 280, margin: 1 });
      }
      res.json({ driver: status.driver, state: status.state, qrDataUrl });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // (Re)connect the configured driver
  app.post("/api/whatsapp/connect", requireAdmin, async (req: Request, res: Response) => {
    try {
      await reconnectDriver();
      logAudit(req, "WHATSAPP_CONNECT", "whatsapp", null, { driver: getDriverStatus().driver });
      res.json({ ok: true, ...getDriverStatus() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message });
    }
  });

  // Unpair / wipe session
  app.post("/api/whatsapp/logout", requireAdmin, async (req: Request, res: Response) => {
    try {
      const driverName = getDriverStatus().driver;
      await logoutDriver();
      logAudit(req, "WHATSAPP_LOGOUT", "whatsapp", null, { driver: driverName });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Switch driver (baileys | meta | none)
  app.post("/api/whatsapp/driver", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { driver } = req.body as { driver: "baileys" | "meta" | "none" };
      if (!["baileys", "meta", "none"].includes(driver)) {
        return res.status(400).json({ error: "Invalid driver" });
      }
      await switchDriver(driver);
      logAudit(req, "WHATSAPP_DRIVER_SWITCH", "whatsapp", null, { driver });
      res.json({ ok: true, ...getDriverStatus() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Agent inbox ────────────────────────────────────────────────────────────

  app.get("/api/whatsapp/conversations", requireAuth, async (_req: Request, res: Response) => {
    try {
      const [threads, unreadTotal] = await Promise.all([listConversations(), getUnreadTotal()]);
      res.json({ conversations: threads, unreadTotal });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/whatsapp/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const before = req.query.before ? Number(req.query.before) : undefined;
      const messages = await getConversationMessages(id, limit, before);
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Agent reply — silences the bot and stamps lastAgentReplyAt
  app.post("/api/whatsapp/conversations/:id/reply", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const { message } = req.body as { message: string };
      if (!message?.trim()) return res.status(400).json({ error: "Message required" });

      const conversation = await getConversation(id);
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });

      const driver = getDriver();
      if (!driver || driver.getState() !== "connected") {
        return res.status(409).json({ error: "WhatsApp is not connected" });
      }

      const result = await driver.sendText(conversation.phone, message.trim());
      if (!result.success) return res.status(502).json({ error: result.error ?? "Send failed" });

      const agentName = (req.user as any)?.username ?? "agent";
      const msg = await recordMessage({
        conversationId: id,
        direction: "out",
        sender: "agent",
        senderName: agentName,
        body: message.trim(),
        waMessageId: result.waMessageId ?? null,
        status: "sent",
      });
      await setAgentReplied(id, agentName);

      void publishRealtime({ type: "WA_MESSAGE", conversationId: id, message: msg });
      void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: id });
      res.json({ ok: true, message: msg });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/whatsapp/conversations/:id/takeover", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const agentName = (req.user as any)?.username ?? "agent";
      await setBotActive(id, false, agentName);
      logAudit(req, "WHATSAPP_TAKEOVER", "conversation", id);
      void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: id });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/whatsapp/conversations/:id/return-to-bot", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      await setBotActive(id, true);
      void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: id });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/whatsapp/conversations/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      await markConversationRead(id);
      void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: id });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}

// ── Public routes — Meta Cloud API webhook (no auth, signature-verified) ──────
//
// Dormant until the Meta driver is active. Configure in the Meta dashboard:
//   Callback URL:  https://<your-host>/api/whatsapp/webhook
//   Verify token:  automation-config.json → metaWebhookVerifyToken

export function registerPublicWhatsAppRoutes(app: Express): void {
  // Webhook verification handshake
  app.get("/api/whatsapp/webhook", (req: Request, res: Response) => {
    const config = getAutomationConfig();
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token && token === config.metaWebhookVerifyToken) {
      return res.status(200).send(String(challenge ?? ""));
    }
    res.sendStatus(403);
  });

  // Inbound messages + delivery statuses
  app.post("/api/whatsapp/webhook", (req: Request, res: Response) => {
    const config = getAutomationConfig();

    // Fail closed: an unsigned webhook would let anyone inject fake inbound
    // messages / delivery receipts. metaAppSecret MUST be configured before
    // the Meta driver goes live.
    if (!config.metaAppSecret) return res.sendStatus(503);

    // Verify X-Hub-Signature-256 over the EXACT bytes Meta sent (rawBody is
    // stashed by the express.json verify hook in server/index.ts) — never a
    // re-serialized req.body, which doesn't round-trip byte-for-byte.
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) return res.sendStatus(401);

    const signature = (req.headers["x-hub-signature-256"] as string) ?? "";
    const expected = "sha256=" + crypto
      .createHmac("sha256", config.metaAppSecret)
      .update(rawBody)
      .digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    if (!valid) return res.sendStatus(401);

    // Always 200 quickly — Meta retries aggressively on non-2xx
    res.sendStatus(200);

    const driver = getDriver();
    if (!(driver instanceof MetaDriver)) return;

    try {
      const entries = req.body?.entry ?? [];
      for (const entry of entries) {
        for (const change of entry?.changes ?? []) {
          const value = change?.value;
          for (const m of value?.messages ?? []) {
            if (m.type !== "text" || !m.text?.body) continue;
            const contact = (value?.contacts ?? []).find((c: any) => c.wa_id === m.from);
            driver.emitInbound({
              waMessageId: m.id,
              phone:       normalizeWaPhone(m.from),
              pushName:    contact?.profile?.name,
              body:        m.text.body,
              timestamp:   new Date(Number(m.timestamp) * 1000 || Date.now()),
            });
          }
          for (const s of value?.statuses ?? []) {
            const status = s.status === "sent" ? "sent"
              : s.status === "delivered" ? "delivered"
              : s.status === "read" ? "read"
              : s.status === "failed" ? "failed"
              : null;
            if (!status || !s.id) continue;
            driver.emitStatusUpdate({
              waMessageId: s.id,
              status,
              error: s.errors?.[0]?.title,
            });
          }
        }
      }
    } catch (err) {
      console.error("[WhatsApp][Meta] webhook parse error:", err);
    }
  });
}
