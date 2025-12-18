import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch, AuthNeededError, API_BASE } from "../services/apiClient";

type AuthState = "unknown" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  state: AuthState;
  loading: boolean;
  loginUrl: string;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function probeAuth(): Promise<boolean> {
  try {
    await apiFetch("/user");
    return true;
  } catch (err) {
    if (err instanceof AuthNeededError) return false;
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("unknown");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const authed = await probeAuth();
    setState(authed ? "authenticated" : "unauthenticated");
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const loginUrl = `${API_BASE}/auth/discord?redirect=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : "/",
  )}`;

  const value = useMemo(
    () => ({
      state,
      loading,
      loginUrl,
      refresh,
    }),
    [state, loading, loginUrl],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
