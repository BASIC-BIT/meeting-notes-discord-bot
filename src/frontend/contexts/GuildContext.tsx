import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch, AuthNeededError } from "../services/apiClient";
import { useAuth } from "./AuthContext";

export type Guild = { id: string; name: string; icon?: string | null };

type GuildContextValue = {
  guilds: Guild[];
  selectedGuildId: string | null;
  setSelectedGuildId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const GuildContext = createContext<GuildContextValue | undefined>(undefined);
const STORAGE_KEY = "mn-selected-guild";

async function fetchGuilds(): Promise<Guild[]> {
  const body = (await apiFetch<{ guilds?: Guild[] }>("/api/guilds")) || {};
  return Array.isArray(body.guilds) ? body.guilds : [];
}

export function GuildProvider({ children }: { children: React.ReactNode }) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { state: authState } = useAuth();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGuilds();
      setGuilds(data);
      if (!selectedGuildId && data.length > 0) {
        setSelectedGuildId(data[0].id);
        localStorage.setItem(STORAGE_KEY, data[0].id);
      } else if (
        selectedGuildId &&
        data.length > 0 &&
        !data.find((g) => g.id === selectedGuildId)
      ) {
        setSelectedGuildId(data[0].id);
        localStorage.setItem(STORAGE_KEY, data[0].id);
      }
    } catch (err) {
      if (err instanceof AuthNeededError) {
        setError("auth");
      } else {
        console.error("Guild fetch error", err);
        setError(
          "Unable to load your servers. Please re-login with the guilds scope.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authState === "authenticated") {
      void load();
    } else if (authState === "unauthenticated") {
      setError("auth");
      setLoading(false);
    }
  }, [authState]);

  const value = useMemo(
    () => ({
      guilds,
      selectedGuildId,
      setSelectedGuildId: (id: string | null) => {
        setSelectedGuildId(id);
        if (id) {
          localStorage.setItem(STORAGE_KEY, id);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      },
      loading,
      error,
      refresh: load,
    }),
    [guilds, selectedGuildId, loading, error],
  );

  return (
    <GuildContext.Provider value={value}>{children}</GuildContext.Provider>
  );
}

export function useGuildContext(): GuildContextValue {
  const ctx = useContext(GuildContext);
  if (!ctx) {
    throw new Error("useGuildContext must be used within GuildProvider");
  }
  return ctx;
}
