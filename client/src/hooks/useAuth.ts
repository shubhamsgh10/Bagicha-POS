import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

interface AuthUser {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
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
