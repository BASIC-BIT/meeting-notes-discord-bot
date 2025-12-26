import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { trpc } from "../services/trpc";
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

export function GuildProvider({ children }: { children: React.ReactNode }) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [error, setError] = useState<string | null>(null);
  const { state: authState } = useAuth();
  const guildQuery = trpc.servers.listEligible.useQuery(undefined, {
    retry: false,
    enabled: authState === "authenticated",
  });
  const loading =
    authState === "authenticated"
      ? guildQuery.isLoading
      : authState === "unknown";

  useEffect(() => {
    if (authState === "unauthenticated") {
      setGuilds([]);
      setSelectedGuildId(null);
      localStorage.removeItem(STORAGE_KEY);
      setError("auth");
      return;
    }
    if (guildQuery.error) {
      if (guildQuery.error.data?.code === "UNAUTHORIZED") {
        setError("auth");
      } else {
        console.error("Guild fetch error", guildQuery.error);
        setError(
          "Unable to load your servers. Please re-login with the guilds scope.",
        );
      }
      return;
    }
    if (guildQuery.data) {
      const data = Array.isArray(guildQuery.data.guilds)
        ? guildQuery.data.guilds
        : [];
      setGuilds(data);
      if (
        selectedGuildId &&
        data.length > 0 &&
        !data.find((g) => g.id === selectedGuildId)
      ) {
        setSelectedGuildId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
      setError(null);
    }
  }, [authState, guildQuery.data, guildQuery.error, selectedGuildId]);

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
      refresh: async () => {
        await guildQuery.refetch();
      },
    }),
    [guilds, selectedGuildId, loading, error, guildQuery],
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
