import React, { createContext, useContext, useMemo } from "react";
import { buildApiUrl } from "../services/apiClient";
import { trpc } from "../services/trpc";

type AuthState = "unknown" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  state: AuthState;
  loading: boolean;
  loginUrl: string;
  refresh: () => Promise<void>;
  user?: {
    id: string;
    username: string;
    avatar: string | null;
    isSuperAdmin?: boolean;
  } | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
  });
  const loading = authQuery.isLoading;
  const state: AuthState = loading
    ? "unknown"
    : authQuery.data
      ? "authenticated"
      : "unauthenticated";

  const portalRedirect =
    typeof window !== "undefined"
      ? `${window.location.origin}/portal/select-server`
      : "/portal/select-server";
  const loginUrl = `${buildApiUrl("/auth/discord")}?redirect=${encodeURIComponent(
    portalRedirect,
  )}`;

  const refetch = authQuery.refetch;
  const value = useMemo(
    () => ({
      state,
      loading,
      loginUrl,
      user: authQuery.data ?? null,
      refresh: async () => {
        await refetch();
      },
    }),
    [state, loading, loginUrl, refetch, authQuery.data],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
