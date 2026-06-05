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
    // Hard-navigate to login: unmounts all components before they can refetch with an expired session
    window.location.href = "/login";
  };

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };
}
