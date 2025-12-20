import { Button, Group, Loader, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import { usePortalStore } from "../stores/portalStore";

export default function ServerSelect() {
  const { guilds, loading, selectedGuildId, setSelectedGuildId } =
    useGuildContext();
  const navigate = useNavigate();
  const setLastServerId = usePortalStore((state) => state.setLastServerId);

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
            We could not find any servers you can manage yet.
          </Text>
        </Stack>
      </Surface>
    );
  }

  return (
    <Stack gap="xl">
      <PageHeader
        title="Choose a server"
        description="Pick the server you want to manage and explore in the Chronote library."
      />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {guilds.map((guild) => (
          <Surface key={guild.id} p="lg" tone="soft">
            <Stack gap="sm">
              <Text fw={600}>{guild.name}</Text>
              <Text size="sm" c="dimmed">
                Manage notes, search, and billing for this server.
              </Text>
              <Button
                variant={selectedGuildId === guild.id ? "light" : "outline"}
                color="brand"
                rightSection={<IconArrowRight size={16} />}
                onClick={() => {
                  setSelectedGuildId(guild.id);
                  setLastServerId(guild.id);
                  navigate({
                    to: "/portal/server/$serverId/library",
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
    </Stack>
  );
}
