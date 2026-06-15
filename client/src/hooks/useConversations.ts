/**
 * useConversations.ts — data layer for the WhatsApp agent inbox.
 *
 * React Query (URL-string keys, repo convention) + targeted invalidation
 * driven by WebSocket events (WA_MESSAGE / WA_STATUS / WA_CONVERSATION_UPDATE /
 * WA_CONNECTION) from the existing /ws server.
 */

import { apiUrl } from "@/lib/api";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/useRealtime";

// ── Types (mirror server/services/whatsapp/conversationStore.ts) ──────────────

export interface ConversationSummary {
  id: number;
  phone: string;
  customerId: string | null;
  displayName: string | null;
  botActive: boolean;
  assignedAgent: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  optedOut: boolean;
  customerName: string | null;
  customerKey: string | null;
  segment: string | null;
}

export interface ConversationMessage {
  id: number;
  conversationId: number;
  direction: "in" | "out";
  sender: "customer" | "bot" | "agent" | "automation";
  senderName: string | null;
  body: string;
  waMessageId: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  trigger: string | null;
  createdAt: string;
}

export interface WhatsAppStatus {
  driver: "baileys" | "meta" | "none";
  state: "disconnected" | "connecting" | "qr_pending" | "connected";
  qrDataUrl: string | null;
}

const CONVERSATIONS_KEY = "/api/whatsapp/conversations";

async function postJson(path: string, body?: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Conversations list (+ unread badge total) ─────────────────────────────────

export function useConversations() {
  const { data, isLoading } = useQuery<{ conversations: ConversationSummary[]; unreadTotal: number }>({
    queryKey: [CONVERSATIONS_KEY],
    staleTime: 10_000,
    retry: 1,
  });
  return {
    conversations: data?.conversations ?? [],
    unreadTotal: data?.unreadTotal ?? 0,
    isLoading,
  };
}

// ── Messages for one thread ───────────────────────────────────────────────────

export function useConversationMessages(conversationId: number | null) {
  const { data, isLoading } = useQuery<{ messages: ConversationMessage[] }>({
    queryKey: [`/api/whatsapp/conversations/${conversationId}/messages`],
    enabled: conversationId != null,
    staleTime: 5_000,
    retry: 1,
  });
  return { messages: data?.messages ?? [], isLoading };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useConversationActions(conversationId: number | null) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    if (conversationId != null) {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/conversations/${conversationId}/messages`] });
    }
  };

  const reply = useMutation({
    mutationFn: (message: string) =>
      postJson(`/api/whatsapp/conversations/${conversationId}/reply`, { message }),
    onSuccess: invalidate,
  });
  const takeover = useMutation({
    mutationFn: () => postJson(`/api/whatsapp/conversations/${conversationId}/takeover`),
    onSuccess: invalidate,
  });
  const returnToBot = useMutation({
    mutationFn: () => postJson(`/api/whatsapp/conversations/${conversationId}/return-to-bot`),
    onSuccess: invalidate,
  });
  const markRead = useMutation({
    mutationFn: () => postJson(`/api/whatsapp/conversations/${conversationId}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] }),
  });

  return { reply, takeover, returnToBot, markRead };
}

// ── Driver status (Setup tab + inbox banner) ──────────────────────────────────

export function useWhatsAppStatus() {
  const { data, isLoading, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status"],
    staleTime: 5_000,
    retry: 1,
    // QR refreshes every ~20s while pairing — poll until connected
    refetchInterval: (query) =>
      query.state.data?.state === "qr_pending" || query.state.data?.state === "connecting" ? 5_000 : false,
  });
  return { status: data ?? null, isLoading, refetch };
}

// ── Real-time invalidation via the existing WebSocket ─────────────────────────

export function useWhatsAppRealtime(activeConversationId: number | null) {
  const queryClient = useQueryClient();
  const { lastMessage } = useRealtime();

  useEffect(() => {
    if (!lastMessage?.type?.startsWith("WA_")) return;

    if (lastMessage.type === "WA_CONNECTION") {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
      return;
    }

    queryClient.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    const convId = lastMessage.conversationId as number | undefined;
    if (convId != null && (activeConversationId == null || convId === activeConversationId)) {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/conversations/${convId}/messages`] });
    }
  }, [lastMessage, activeConversationId, queryClient]);
}
