import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { apiUrl } from "./api";
import { toast } from "@/hooks/use-toast";

type UnauthorizedBehavior = "returnNull" | "throw";

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
): Promise<Response> {
  const res = await fetch(apiUrl(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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
    const res = await fetch(apiUrl(path), {
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
    onError: (error) => {
      console.error("[query error]", error);
      Sentry.captureException(error);
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
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
