import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import axios from "axios";
import { API_PATHS } from "@shared/core/constants";
import type { ApiSuccessResponse, LoginResponseDto } from "@shared/core/types";
import { useAuthStore } from "@/store/useAuthStore";

export interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * On first mount (page refresh), the in-memory access token is always `null`
 * because tokens are held purely in JS memory (AGENTS.md §7). Before
 * redirecting to /login we attempt a silent refresh using the HttpOnly
 * `refreshToken` cookie. Only if that fails do we redirect.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const location = useLocation();
  const [isRefreshing, setIsRefreshing] = useState(!accessToken);

  useEffect(() => {
    if (accessToken) {
      setIsRefreshing(false);
      return;
    }

    let cancelled = false;

    async function attemptSilentRefresh(): Promise<void> {
      try {
        const response = await axios.post<ApiSuccessResponse<LoginResponseDto>>(
          `${API_PATHS.BASE}${API_PATHS.AUTH.ROOT}${API_PATHS.AUTH.REFRESH}`,
          undefined,
          { withCredentials: true },
        );
        if (!cancelled) {
          const { accessToken: token, user } = response.data.data;
          useAuthStore.getState().setSession({ accessToken: token, user });
        }
      } catch {
        // Refresh failed — no valid session; will redirect below.
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    attemptSilentRefresh();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (isRefreshing) {
    // Show a minimal loading indicator while the silent refresh is in-flight
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafbfc]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />
          <span className="text-sm text-zinc-500">Loading...</span>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    const next = encodeURIComponent(location.pathname);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}
