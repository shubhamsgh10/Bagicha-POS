import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { clearPersistedCache } from "@/lib/queryPersistence";

interface AuthUser {
  id: number;
  username: string;
  role: string;
  createdAt: string;
  /** Set on a staff-member PIN session — `id` refers to `staffMembers.id`, not `users.id`. */
  _isStaffMember?: boolean;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading, status, isFetchedAfterMount } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  // The server really answered "not signed in" (a real fetch this mount, not restored data, not a
  // network error): wipe the saved screen data once. Offline errors never reach here.
  const wipedRef = useRef(false);
  useEffect(() => {
    if (!wipedRef.current && isFetchedAfterMount && status === "success" && user == null) {
      wipedRef.current = true;
      void clearPersistedCache();
    }
  }, [isFetchedAfterMount, status, user]);

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } finally {
      // Desktop app: wipe the saved screen data (even if the request failed) so the next person never sees it.
      await clearPersistedCache();
    }
    // Hard-reload: unmounts all components before they can refetch with an expired session.
    // Reloads the current URL (not a hardcoded "/login" — there is no such route; App.tsx shows
    // the Login panel purely from isAuthenticated state) so this also works under the Electron
    // thin-client's file:// origin, which has no server to resolve an absolute "/login" path against.
    window.location.reload();
  };

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };
}
