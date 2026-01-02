import {
  Avatar,
  Button,
  Group,
  Loader,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconArrowRight, IconCheck, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { Guild } from "../contexts/GuildContext";
import Surface from "./Surface";
import { uiBorders, uiColors } from "../uiTokens";

type ServerPickerProps = {
  guilds: Guild[];
  loading: boolean;
  selectedGuildId?: string | null;
  onSelect?: (guildId: string) => void;
  onAction?: (guild: Guild) => void;
  actionLabel?: (guild: Guild) => string;
  actionDisabled?: (guild: Guild) => boolean;
  description?: (guild: Guild) => string;
  filter?: (guild: Guild) => boolean;
  emptyTitle: string;
  emptyDescription: string;
  searchEmptyMessage?: string;
  searchPlaceholder?: string;
  rootTestId?: string;
  cardTestId?: string;
  actionTestId?: string;
  showSearch?: boolean;
};

const resolveGuildIconUrl = (guild: Guild): string | null => {
  if (!guild.icon) return null;
  const extension = guild.icon.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${extension}?size=128`;
};

export default function ServerPicker({
  guilds,
  loading,
  selectedGuildId,
  onSelect,
  onAction,
  actionLabel,
  actionDisabled,
  description,
  filter,
  emptyTitle,
  emptyDescription,
  searchPlaceholder = "Search servers",
  rootTestId,
  cardTestId,
  actionTestId,
  showSearch = true,
}: ServerPickerProps) {
  const [query, setQuery] = useState("");

  const { baseGuilds, filteredGuilds } = useMemo(() => {
    const base = filter ? guilds.filter(filter) : guilds;
    if (!query.trim()) {
      return { baseGuilds: base, filteredGuilds: base };
    }
    const needle = query.toLowerCase();
    return {
      baseGuilds: base,
      filteredGuilds: base.filter((guild) =>
        guild.name.toLowerCase().includes(needle),
      ),
    };
  }, [filter, guilds, query]);

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

  if (baseGuilds.length === 0) {
    return (
      <Surface p="xl">
        <Stack gap="sm">
          <Text fw={600}>{emptyTitle}</Text>
          <Text c="dimmed">{emptyDescription}</Text>
        </Stack>
      </Surface>
    );
  }

  if (filteredGuilds.length === 0) {
    return (
      <Surface p="lg" tone="soft">
        <Text size="sm" c="dimmed">
          {searchEmptyMessage ?? "No servers match that search."}
        </Text>
      </Surface>
    );
  }

  return (
    <Stack gap="lg" data-testid={rootTestId}>
      {showSearch ? (
        <TextInput
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          data-testid="server-search"
        />
      ) : null}
      <ScrollArea
        offsetScrollbars
        type="auto"
        style={{ maxHeight: "60vh" }}
        data-visual-scroll
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          {filteredGuilds.map((guild) => {
            const selected = selectedGuildId === guild.id;
            const handleAction = () => {
              onSelect?.(guild.id);
              onAction?.(guild);
            };
            const label = actionLabel ? actionLabel(guild) : "Select";
            const disabled = actionDisabled ? actionDisabled(guild) : false;
            const details = description ? description(guild) : "";
            const iconUrl = resolveGuildIconUrl(guild);
            return (
              <Surface
                key={guild.id}
                p="lg"
                tone="soft"
                data-testid={cardTestId}
                data-server-id={guild.id}
                data-selected={selected ? "true" : "false"}
                style={{
                  borderWidth: selected ? uiBorders.highlightWidth : undefined,
                  borderColor: selected ? uiColors.highlightBorder : undefined,
                }}
              >
                <Stack gap="sm">
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Group gap="sm" align="center">
                      <Avatar
                        src={iconUrl ?? undefined}
                        radius="md"
                        size={48}
                        color="brand"
                        variant="light"
                      >
                        {guild.name.slice(0, 2).toUpperCase()}
                      </Avatar>
                      <Stack gap={2}>
                        <Text fw={600}>{guild.name}</Text>
                        {details ? (
                          <Text size="sm" c="dimmed">
                            {details}
                          </Text>
                        ) : null}
                      </Stack>
                    </Group>
                    {selected ? (
                      <ThemeIcon color="brand" variant="light" size="md">
                        <IconCheck size={14} />
                      </ThemeIcon>
                    ) : null}
                  </Group>
                  <Button
                    variant={selected ? "light" : "outline"}
                    color="brand"
                    rightSection={<IconArrowRight size={16} />}
                    data-testid={actionTestId}
                    onClick={handleAction}
                    disabled={disabled}
                  >
                    {label}
                  </Button>
                </Stack>
              </Surface>
            );
          })}
        </SimpleGrid>
      </ScrollArea>
    </Stack>
  );
}
