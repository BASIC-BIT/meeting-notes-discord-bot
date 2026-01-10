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
  sections?: ServerPickerSection[];
  emptyTitle: string;
  emptyDescription: string;
  searchEmptyMessage?: string;
  searchPlaceholder?: string;
  rootTestId?: string;
  cardTestId?: string;
  actionTestId?: string;
  showSearch?: boolean;
};

type ServerPickerSection = {
  title: string;
  description?: string;
  filter: (guild: Guild) => boolean;
  testId?: string;
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
  sections,
  emptyTitle,
  emptyDescription,
  searchEmptyMessage,
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

  const renderGuildCards = (items: Guild[]) => (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      {items.map((guild) => {
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
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={disabled ? undefined : handleAction}
            onKeyDown={(event) => {
              if (disabled) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleAction();
              }
            }}
            style={{
              borderWidth: selected ? uiBorders.highlightWidth : undefined,
              borderColor: selected ? uiColors.highlightBorder : undefined,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "transform 120ms ease, box-shadow 120ms ease",
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
                  <Text fw={600}>{guild.name}</Text>
                </Group>
                <Group gap="xs" align="center">
                  {selected ? (
                    <ThemeIcon color="brand" variant="light" size="md">
                      <IconCheck size={14} />
                    </ThemeIcon>
                  ) : null}
                  <Button
                    variant="subtle"
                    color="brand"
                    size="xs"
                    rightSection={<IconArrowRight size={14} />}
                    data-testid={actionTestId}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAction();
                    }}
                    disabled={disabled}
                  >
                    {label}
                  </Button>
                </Group>
              </Group>
              {details ? (
                <Text size="sm" c="dimmed">
                  {details}
                </Text>
              ) : null}
            </Stack>
          </Surface>
        );
      })}
    </SimpleGrid>
  );

  const resolvedSections = sections
    ? sections
        .map((section) => ({
          ...section,
          guilds: filteredGuilds.filter(section.filter),
        }))
        .filter((section) => section.guilds.length > 0)
    : null;

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
        {resolvedSections ? (
          resolvedSections.length > 0 ? (
            <Stack gap="lg">
              {resolvedSections.map((section) => (
                <Stack
                  key={section.title}
                  gap="sm"
                  data-testid={section.testId}
                >
                  <Text fw={600} size="sm">
                    {section.title}
                  </Text>
                  {section.description ? (
                    <Text size="sm" c="dimmed">
                      {section.description}
                    </Text>
                  ) : null}
                  {renderGuildCards(section.guilds)}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Surface p="lg" tone="soft">
              <Text size="sm" c="dimmed">
                {searchEmptyMessage ?? "No servers match that search."}
              </Text>
            </Surface>
          )
        ) : (
          renderGuildCards(filteredGuilds)
        )}
      </ScrollArea>
    </Stack>
  );
}
