import { useEffect } from "react";
import { Navigate, Outlet, useParams } from "@tanstack/react-router";
import { useGuildContext } from "../contexts/GuildContext";
import { usePortalStore } from "../stores/portalStore";

export default function PortalServerLayout() {
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  const { selectedGuildId, setSelectedGuildId, guilds, loading } =
    useGuildContext();
  const setLastServerId = usePortalStore((state) => state.setLastServerId);

  useEffect(() => {
    if (!serverId || loading) return;
    if (selectedGuildId !== serverId) {
      setSelectedGuildId(serverId);
    }
    setLastServerId(serverId);
  }, [serverId, loading, selectedGuildId, setSelectedGuildId, setLastServerId]);

  if (loading) {
    return null;
  }

  if (serverId && guilds.length > 0 && !guilds.some((g) => g.id === serverId)) {
    return <Navigate to="/portal/select-server" />;
  }

  return <Outlet />;
}
