import { create } from "zustand";
import { persist } from "zustand/middleware";

type PortalState = {
  lastServerId: string | null;
  setLastServerId: (serverId: string | null) => void;
};

export const usePortalStore = create<PortalState>()(
  persist(
    (set) => ({
      lastServerId: null,
      setLastServerId: (serverId) => set({ lastServerId: serverId }),
    }),
    {
      name: "chronote-portal",
    },
  ),
);
