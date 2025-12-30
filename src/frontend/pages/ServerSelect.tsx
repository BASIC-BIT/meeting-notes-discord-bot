import {
  Button,
  Group,
  Loader,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconArrowRight, IconSearch } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import { usePortalStore } from "../stores/portalStore";

export default function ServerSelect() {
  const { guilds, loading, selectedGuildId, setSelectedGuildId } =
    useGuildContext();
  const navigate = useNavigate();
  const setLastServerId = usePortalStore((state) => state.setLastServerId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (selectedGuildId) {
      setSelectedGuildId(null);
    }
  }, [selectedGuildId, setSelectedGuildId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return guilds;
    const needle = query.toLowerCase();
    return guilds.filter((guild) => guild.name.toLowerCase().includes(needle));
  }, [guilds, query]);

  if (loading) {
    return (
      <Surface p="xl">
        <Group gap="sm">
          <Loader size="sm" color="brand" />
          <Text c="dimmed">Loading your servers...</Text>
        </Group>
      </Surface>
    );
  }

  if (guilds.length === 0) {
    return (
      <Surface p="xl">
        <Stack gap="sm">
          <Text fw={600}>No servers found</Text>
          <Text c="dimmed">
            We could not find any servers with Chronote installed yet.
          </Text>
        </Stack>
      </Surface>
    );
  }

  return (
    <Stack gap="xl" data-testid="server-select">
      <PageHeader
        title="Choose a server"
        description="Pick a server to manage settings or view shared Ask threads."
      />
      <TextInput
        placeholder="Search servers"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
        data-testid="server-search"
      />
      <ScrollArea offsetScrollbars type="auto" style={{ maxHeight: "60vh" }}>
        {filtered.length === 0 ? (
          <Surface p="lg" tone="soft">
            <Text size="sm" c="dimmed">
              No servers match that search.
            </Text>
          </Surface>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            {filtered.map((guild) => (
              <Surface
                key={guild.id}
                p="lg"
                tone="soft"
                data-testid="server-card"
                data-server-id={guild.id}
              >
                <Stack gap="sm">
                  <Text fw={600}>{guild.name}</Text>
                  <Text size="sm" c="dimmed">
                    {guild.canManage
                      ? "Manage notes, Ask, and billing for this server."
                      : "View shared Ask threads for this server."}
                  </Text>
                  <Button
                    variant={selectedGuildId === guild.id ? "light" : "outline"}
                    color="brand"
                    rightSection={<IconArrowRight size={16} />}
                    data-testid="server-open"
                    onClick={() => {
                      setSelectedGuildId(guild.id);
                      setLastServerId(guild.id);
                      navigate({
                        to: guild.canManage
                          ? "/portal/server/$serverId/library"
                          : "/portal/server/$serverId/ask",
                        params: { serverId: guild.id },
                      });
                    }}
                  >
                    Open server
                  </Button>
                </Stack>
              </Surface>
            ))}
          </SimpleGrid>
        )}
      </ScrollArea>
    </Stack>
  );
}
