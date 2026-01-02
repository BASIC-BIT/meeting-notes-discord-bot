import { Stack } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import ServerPicker from "../components/ServerPicker";
import { usePortalStore } from "../stores/portalStore";

export default function ServerSelect() {
  const { guilds, loading, selectedGuildId, setSelectedGuildId } =
    useGuildContext();
  const navigate = useNavigate();
  const search = useSearch({ from: "/portal/select-server" });
  const promoCode = search.promo?.trim() ?? "";
  const hasPromo = promoCode.length > 0;
  const setLastServerId = usePortalStore((state) => state.setLastServerId);
  useEffect(() => {
    if (selectedGuildId) {
      setSelectedGuildId(null);
    }
  }, [selectedGuildId, setSelectedGuildId]);

  return (
    <Stack gap="xl" data-testid="server-select">
      <PageHeader
        title="Choose a server"
        description="Pick a server to manage settings or view shared Ask threads."
      />
      <ServerPicker
        guilds={guilds}
        loading={loading}
        selectedGuildId={selectedGuildId}
        onSelect={(guildId) => {
          setSelectedGuildId(guildId);
          setLastServerId(guildId);
        }}
        onAction={(guild) => {
          navigate({
            to: guild.canManage
              ? hasPromo
                ? "/portal/server/$serverId/billing"
                : "/portal/server/$serverId/library"
              : "/portal/server/$serverId/ask",
            params: { serverId: guild.id },
            search:
              guild.canManage && hasPromo ? { promo: promoCode } : undefined,
          });
        }}
        actionLabel={() => "Open server"}
        actionDisabled={() => false}
        description={(guild) =>
          guild.canManage
            ? "Manage notes, Ask, and billing for this server."
            : "View shared Ask threads for this server."
        }
        emptyTitle="No servers found"
        emptyDescription="We could not find any servers with Chronote installed yet."
        cardTestId="server-card"
        actionTestId="server-open"
      />
    </Stack>
  );
}
