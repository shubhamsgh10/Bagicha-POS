import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { timedFetch, IDEMPOTENCY_HEADER, newIdempotencyKey } from "./api";
import { toast } from "@/hooks/use-toast";
import { recordQueryError } from "./errorReporter";

type UnauthorizedBehavior = "returnNull" | "throw";

/** True for the error throwIfResNotOk raises on a 401 ("401: ..."). */
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("401:");
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  opts?: { idempotent?: boolean },
): Promise<Response> {
  // timedFetch: timed + reported when slow (lib/slowRequest.ts). A write is resent (once, by the
  // desktop stall breaker) only when it carries a one-time key — opts.idempotent, used on the routes
  // routes server/requestKeys.ts protects. One call = one key; a new tap makes a new call.
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  if (opts?.idempotent) headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
  const res = await timedFetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/") as string;
    // timedFetch: a GET with no response headers in 8s is aborted and retried once, and slow ones
    // are reported with the server's own timing (lib/slowRequest.ts).
    const res = await timedFetch(path, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  // Background queries fail silently to the user by design — most poll (tables,
  // live-status, orders every 5s) and a toast per failed poll would spam. Still log/report
  // it somewhere instead of it vanishing entirely (previously: nowhere at all).
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error("[query error]", error);
      Sentry.captureException(error);
      recordQueryError(query.queryKey, error); // breadcrumb for the next crash report
      // The session is gone (expired / signed out elsewhere): re-read /api/auth/me now so the app
      // shows the sign-in screen instead of waiting out its 5-minute staleTime on stale screens.
      if (isUnauthorizedError(error) && query.queryKey[0] !== "/api/auth/me") {
        void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
    },
  }),
  // Most mutations already show their own toast via a local onError. This fallback only
  // fires for the ones that don't (mutation.options.onError is unset) — those previously
  // failed completely silently (e.g. useConversations.ts's reply/takeover/returnToBot/
  // markRead, Menu.tsx's delete, Staff.tsx's remove). Checking for a local handler avoids
  // double-toasting the ~45 mutations that already handle their own error.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      console.error("[mutation error]", error);
      Sentry.captureException(error);
      if (mutation.options.onError) return;
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "The action didn't complete.",
        variant: "destructive",
      });
    },
  }),
  defaultOptions: {
    queries: {
      // A 401 is an ERROR for every query except /api/auth/me (useAuth asks for "returnNull"
      // itself). Resolving it as a successful `null` replaced lists with null when the 24 h session
      // ran out mid-shift: `tables.filter` threw (ErrorBoundary), the desktop persister saved that
      // null next to a still-signed-in /api/auth/me, and every Reload crashed again (17 Nov 2026).
      // As an error the last good data stays on screen and queryCache.onError re-checks the session.
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
      // TanStack Query's default ("online") PARKS a mutation, sending nothing, whenever the browser
      // reports offline (a WiFi roam, a tablet waking from sleep, a flaky router) — the button
      // just sits on "…" with no error and no request, until an `online` event arrives, which on a
      // flapping or falsely-offline connection can be a minute. That is exactly "Settle sometimes
      // takes up to a minute but always works": reproduced in a real browser (offline → Settle Now →
      // 0 requests sent → reconnect → PUT + POST fire at once). For a POS, a payment silently queued
      // in limbo is worse than one that fails at once: always attempt the request, so a truly dead
      // network fails immediately and the existing onError toasts tell staff to retry.
      networkMode: "always",
    },
  },
});
