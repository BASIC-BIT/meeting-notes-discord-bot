import { useMemo, useState, type ComponentType } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Drawer,
  Group,
  Loader,
  MultiSelect,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import {
  IconChevronRight,
  IconDownload,
  IconFilter,
  IconMessageCircle,
  IconMicrophone,
  IconNote,
  IconRefresh,
  IconSearch,
  IconSpeakerphone,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import { format } from "date-fns";
import Surface from "../components/Surface";
import PageHeader from "../components/PageHeader";
import FormSelect from "../components/FormSelect";
import { trpc } from "../services/trpc";
import { useGuildContext } from "../contexts/GuildContext";
import { uiOverlays } from "../uiTokens";

type MeetingEvent = {
  id: string;
  type: "voice" | "chat" | "tts" | "presence" | "bot";
  time: string;
  speaker?: string;
  text: string;
};

type MeetingDetails = {
  id: string;
  title: string;
  summary: string;
  summaryLabel?: string;
  notes: string;
  dateLabel: string;
  durationLabel: string;
  tags: string[];
  channel: string;
  audioUrl?: string | null;
  attendees: string[];
  decisions: string[];
  actions: string[];
  events: MeetingEvent[];
  status?: "in_progress" | "complete";
};

type MeetingExport = {
  meeting: {
    id: string;
    meetingId: string;
    channelId: string;
    timestamp: string;
    duration: number;
    tags: string[];
    notes: string;
    notesChannelId?: string;
    notesMessageId?: string;
    transcript: string;
    audioUrl?: string;
    attendees: string[];
    events: MeetingEvent[];
    title: string;
    summary: string;
    summaryLabel?: string;
    summarySentence?: string;
    dateLabel: string;
    durationLabel: string;
    channel: string;
  };
};

type MeetingSummaryRow = {
  id: string;
  meetingId: string;
  channelId: string;
  channelName: string;
  timestamp: string;
  duration: number;
  tags: string[];
  notes: string;
  summarySentence?: string;
  summaryLabel?: string;
  notesChannelId?: string;
  notesMessageId?: string;
  audioAvailable: boolean;
  transcriptAvailable: boolean;
  status?: "in_progress" | "complete";
};

type MeetingListItem = MeetingSummaryRow & {
  title: string;
  summary: string;
  summaryLabel?: string;
  dateLabel: string;
  durationLabel: string;
  channelLabel: string;
};

type RawMeetingDetail = {
  id: string;
  channelId: string;
  timestamp: string;
  duration: number;
  tags?: string[];
  notes?: string | null;
  summarySentence?: string | null;
  summaryLabel?: string | null;
  audioUrl?: string | null;
  attendees?: string[];
  events?: MeetingEvent[];
  status?: "in_progress" | "complete";
};

const FILTER_OPTIONS = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "tts", label: "Spoken chat" },
  { value: "presence", label: "Joins/Leaves" },
  { value: "bot", label: "Bot" },
];

const EVENT_META: Record<
  MeetingEvent["type"],
  { color: string; label: string; icon: ComponentType<{ size?: number }> }
> = {
  voice: { color: "brand", label: "Voice", icon: IconMicrophone },
  chat: { color: "cyan", label: "Chat", icon: IconMessageCircle },
  tts: { color: "teal", label: "Spoken chat", icon: IconSpeakerphone },
  presence: { color: "gray", label: "Join/leave", icon: IconUsers },
  bot: { color: "violet", label: "Chronote", icon: IconSparkles },
};

const formatChannelLabel = (name?: string, fallback?: string) => {
  const raw = name ?? fallback ?? "Unknown channel";
  return raw.startsWith("#") ? raw : `#${raw}`;
};

const formatDurationLabel = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
};

const formatDateLabel = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return format(date, "MMM d, yyyy");
};

const normalizeNotes = (notes: string) => notes.replace(/\r/g, "").trim();

const deriveTitle = (notes: string, channelLabel: string) => {
  const lines = normalizeNotes(notes)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const skip = new Set([
    "highlights",
    "decisions",
    "action items",
    "actions",
    "recap",
    "summary",
  ]);
  const candidate = lines.find((line) => !skip.has(line.toLowerCase()));
  if (candidate) {
    return candidate.replace(/^[-*#]\s*/, "");
  }
  return `Meeting in ${channelLabel.replace(/^#/, "")}`;
};

const deriveSummary = (notes: string, summarySentence?: string | null) => {
  if (summarySentence && summarySentence.trim().length > 0) {
    return summarySentence.trim();
  }
  const normalized = normalizeNotes(notes);
  if (!normalized) {
    return "Notes will appear after the meeting is processed.";
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summaryLine = lines.find((line) =>
    line.toLowerCase().includes("summary"),
  );
  if (summaryLine) {
    return summaryLine.replace(/^summary[:\s-]*/i, "");
  }
  const singleLine = lines.join(" ").replace(/\s+/g, " ");
  if (singleLine.length <= 180) {
    return singleLine;
  }
  return `${singleLine.slice(0, 180)}...`;
};

const filterMeetings = (
  meetingItems: MeetingListItem[],
  options: {
    query: string;
    selectedTags: string[];
    selectedChannel: string | null;
    selectedRange: string;
  },
) => {
  const { query, selectedTags, selectedChannel, selectedRange } = options;
  const rangeDays =
    selectedRange === "all" ? null : Number.parseInt(selectedRange, 10);
  const now = Date.now();
  const needle = query.toLowerCase();

  return meetingItems.filter((meetingItem) => {
    if (query) {
      const text = `${meetingItem.title} ${meetingItem.summary}`.toLowerCase();
      if (!text.includes(needle)) return false;
    }
    if (selectedTags.length) {
      const matches = selectedTags.every((tag) =>
        meetingItem.tags.includes(tag),
      );
      if (!matches) return false;
    }
    if (selectedChannel && meetingItem.channelId !== selectedChannel) {
      return false;
    }
    if (rangeDays) {
      const ts = Date.parse(meetingItem.timestamp);
      if (Number.isFinite(ts)) {
        const diffDays = (now - ts) / (1000 * 60 * 60 * 24);
        if (diffDays > rangeDays) return false;
      }
    }
    return true;
  });
};

const buildMeetingDetails = (
  detail: RawMeetingDetail,
  channelNameMap: Map<string, string>,
): MeetingDetails => {
  const channelLabel = formatChannelLabel(
    channelNameMap.get(detail.channelId),
    detail.channelId,
  );
  const dateLabel = formatDateLabel(detail.timestamp);
  const durationLabel = formatDurationLabel(detail.duration);
  const title = deriveTitle(detail.notes ?? "", channelLabel);
  const summary = deriveSummary(detail.notes ?? "", detail.summarySentence);
  return {
    id: detail.id,
    title,
    summary,
    summaryLabel: detail.summaryLabel ?? undefined,
    notes: detail.notes || "No notes recorded.",
    dateLabel,
    durationLabel,
    tags: detail.tags ?? [],
    channel: channelLabel,
    audioUrl: detail.audioUrl ?? null,
    attendees:
      detail.attendees && detail.attendees.length > 0
        ? detail.attendees
        : ["Unknown"],
    decisions: [],
    actions: [],
    events: detail.events ?? [],
    status: detail.status ?? "complete",
  } satisfies MeetingDetails;
};

export default function Library() {
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  const trpcUtils = trpc.useUtils();

  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRange, setSelectedRange] = useState("30");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null,
  );
  const [activeFilters, setActiveFilters] = useState<string[]>(
    FILTER_OPTIONS.map((filter) => filter.value),
  );
  const [fullScreen, setFullScreen] = useState(false);

  const { selectedGuildId } = useGuildContext();
  const meetingsQuery = trpc.meetings.list.useQuery(
    {
      serverId: selectedGuildId ?? "",
      limit: 50,
    },
    { enabled: Boolean(selectedGuildId) },
  );
  const channelsQuery = trpc.servers.channels.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) },
  );
  const detailQuery = trpc.meetings.detail.useQuery(
    {
      serverId: selectedGuildId ?? "",
      meetingId: selectedMeetingId ?? "",
    },
    { enabled: Boolean(selectedGuildId && selectedMeetingId) },
  );

  const channelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const voiceChannels = channelsQuery.data?.voiceChannels ?? [];
    const textChannels = channelsQuery.data?.textChannels ?? [];
    [...voiceChannels, ...textChannels].forEach((channel) => {
      map.set(channel.id, channel.name);
    });
    return map;
  }, [channelsQuery.data]);

  const meetingRows = useMemo<MeetingSummaryRow[]>(
    () => meetingsQuery.data?.meetings ?? [],
    [meetingsQuery.data],
  );

  const meetingItems = useMemo<MeetingListItem[]>(() => {
    return meetingRows.map((meetingRow) => {
      const channelLabel = formatChannelLabel(
        channelNameMap.get(meetingRow.channelId) ?? meetingRow.channelName,
        meetingRow.channelId,
      );
      const dateLabel = formatDateLabel(meetingRow.timestamp);
      const durationLabel = formatDurationLabel(meetingRow.duration);
      const title = deriveTitle(meetingRow.notes, channelLabel);
      const summary = deriveSummary(
        meetingRow.notes,
        meetingRow.summarySentence,
      );
      return {
        ...meetingRow,
        title,
        summary,
        summaryLabel: meetingRow.summaryLabel ?? undefined,
        dateLabel,
        durationLabel,
        channelLabel,
      };
    });
  }, [meetingRows, channelNameMap]);

  const tagOptions = useMemo(
    () =>
      Array.from(
        new Set(meetingRows.flatMap((meeting) => meeting.tags)),
      ).sort(),
    [meetingRows],
  );

  const channelOptions = useMemo(() => {
    const ids = new Set(
      meetingRows.map((meeting) => meeting.channelId).filter(Boolean),
    );
    return Array.from(ids).map((id) => ({
      value: id,
      label: formatChannelLabel(channelNameMap.get(id), id),
    }));
  }, [meetingRows, channelNameMap]);

  const filtered = useMemo(
    () =>
      filterMeetings(meetingItems, {
        query,
        selectedTags,
        selectedChannel,
        selectedRange,
      }),
    [meetingItems, query, selectedTags, selectedChannel, selectedRange],
  );

  const meeting = useMemo(() => {
    const detail = detailQuery.data?.meeting;
    return detail ? buildMeetingDetails(detail, channelNameMap) : null;
  }, [detailQuery.data, channelNameMap]);

  const visibleEvents = useMemo(() => {
    if (!meeting) return [];
    return meeting.events.filter((event) => activeFilters.includes(event.type));
  }, [meeting, activeFilters]);

  const listLoading = meetingsQuery.isLoading || channelsQuery.isLoading;
  const listError = meetingsQuery.error ?? channelsQuery.error;
  const detailLoading = detailQuery.isLoading || detailQuery.isFetching;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!selectedGuildId) return;
    try {
      setRefreshing(true);
      await Promise.all([
        trpcUtils.meetings.list.invalidate({ serverId: selectedGuildId }),
        trpcUtils.meetings.detail.invalidate(),
        trpcUtils.servers.channels.invalidate({ serverId: selectedGuildId }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownload = () => {
    const detail = detailQuery.data?.meeting;
    if (!detail || !meeting) return;
    const payload: MeetingExport = {
      meeting: {
        id: detail.id,
        meetingId: detail.meetingId,
        channelId: detail.channelId,
        timestamp: detail.timestamp,
        duration: detail.duration,
        tags: detail.tags ?? [],
        notes: detail.notes ?? "",
        notesChannelId: detail.notesChannelId,
        notesMessageId: detail.notesMessageId,
        transcript: detail.transcript ?? "",
        audioUrl: detail.audioUrl,
        attendees: detail.attendees ?? [],
        events: detail.events ?? [],
        title: meeting.title,
        summary: meeting.summary,
        summarySentence: detail.summarySentence ?? undefined,
        summaryLabel: meeting.summaryLabel,
        dateLabel: meeting.dateLabel,
        durationLabel: meeting.durationLabel,
        channel: meeting.channel,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${meeting.title.replace(/[^\w-]+/g, "_") || "meeting"}-${meeting.dateLabel.replace(
      /\s+/g,
      "_",
    )}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack gap="lg" data-testid="library-page">
      <PageHeader
        title="Library"
        description="Every session, indexed by tags, channel, and timeline."
      />

      <Surface p="lg" tone="soft">
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search meetings"
            leftSection={<IconSearch size={16} />}
            data-testid="library-search"
          />
          <MultiSelect
            data={tagOptions}
            placeholder="Tags"
            value={selectedTags}
            onChange={setSelectedTags}
            searchable
            clearable
          />
          <FormSelect
            value={selectedRange}
            onChange={(value) => setSelectedRange(value || "30")}
            data={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
              { value: "all", label: "All time" },
            ]}
          />
          <FormSelect
            placeholder="Channel"
            value={selectedChannel}
            onChange={setSelectedChannel}
            data={channelOptions}
            clearable
          />
        </SimpleGrid>
      </Surface>

      <Group justify="space-between" align="center" wrap="wrap">
        <Text c="dimmed" size="sm">
          {filtered.length} meetings
        </Text>
        <Group gap="sm" align="center">
          <Text size="xs" c="dimmed">
            Sorted by recency •{" "}
            {selectedRange === "all"
              ? "All time"
              : `Range: ${selectedRange} days`}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            loading={refreshing || meetingsQuery.isFetching}
            onClick={handleRefresh}
            data-testid="library-refresh"
          >
            Refresh
          </Button>
        </Group>
      </Group>

      <Surface
        p={0}
        style={{ position: "relative" }}
        data-testid="library-list"
      >
        {listLoading ? (
          <Center
            py="xl"
            style={{ minHeight: 240 }}
            data-testid="library-loading"
          >
            <Loader color="brand" />
          </Center>
        ) : listError ? (
          <Center py="xl">
            <Text c="dimmed">Unable to load meetings. Try again shortly.</Text>
          </Center>
        ) : filtered.length === 0 && !listLoading ? (
          <Center py="xl">
            <Text c="dimmed">No meetings match these filters yet.</Text>
          </Center>
        ) : (
          <Stack gap={0}>
            {filtered.map((meetingItem, index) => (
              <Box
                key={meetingItem.id}
                px={{ base: "md", md: "lg" }}
                py="md"
                onClick={() => setSelectedMeetingId(meetingItem.id)}
                data-testid="library-meeting-row"
                data-meeting-id={meetingItem.id}
                style={{
                  cursor: "pointer",
                  borderBottom:
                    index === filtered.length - 1
                      ? undefined
                      : `1px solid ${
                          isDark ? theme.colors.dark[5] : theme.colors.gray[2]
                        }`,
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={6} style={{ flex: 1 }}>
                    <Group gap="xs" align="center" wrap="wrap">
                      <Text fw={650}>{meetingItem.title}</Text>
                      {meetingItem.status === "in_progress" ? (
                        <Badge color="red" variant="light">
                          Live
                        </Badge>
                      ) : null}
                    </Group>
                    {meetingItem.summaryLabel ? (
                      <Text size="xs" c="dimmed">
                        {meetingItem.summaryLabel}
                      </Text>
                    ) : null}
                    <Text size="sm" c="dimmed">
                      {meetingItem.summary}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {meetingItem.dateLabel} • {meetingItem.durationLabel} •{" "}
                      {meetingItem.channelLabel}
                    </Text>
                    <Group gap="xs" wrap="wrap">
                      {meetingItem.tags.map((tag) => (
                        <Badge key={tag} variant="light" color="gray">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  </Stack>
                  <ActionIcon
                    variant="light"
                    color="gray"
                    aria-label="Open meeting"
                  >
                    <IconChevronRight size={18} />
                  </ActionIcon>
                </Group>
              </Box>
            ))}
          </Stack>
        )}
      </Surface>

      <Drawer
        opened={!!selectedMeetingId}
        onClose={() => {
          setSelectedMeetingId(null);
          setFullScreen(false);
        }}
        position="right"
        size={fullScreen ? "100%" : "xl"}
        overlayProps={uiOverlays.modal}
        data-testid="meeting-drawer"
        styles={{
          content: {
            backgroundColor: isDark ? theme.colors.dark[7] : theme.white,
          },
        }}
      >
        {selectedMeetingId ? (
          <Box style={{ position: "relative" }}>
            {detailQuery.error ? (
              <Center py="xl">
                <Text c="dimmed">Unable to load meeting details.</Text>
              </Center>
            ) : detailLoading ? (
              <Center py="xl">
                <Loader color="brand" />
              </Center>
            ) : meeting ? (
              <Stack gap="md">
                <Stack gap={4}>
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Group gap="xs" align="center" wrap="wrap">
                      <Title order={3}>{meeting.title}</Title>
                      {meeting.status === "in_progress" ? (
                        <Badge color="red" variant="light">
                          Live
                        </Badge>
                      ) : null}
                    </Group>
                    <Group gap="sm">
                      <Button
                        variant="light"
                        leftSection={<IconDownload size={16} />}
                        onClick={handleDownload}
                        data-testid="meeting-download"
                      >
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        leftSection={<IconFilter size={16} />}
                        onClick={() => setFullScreen((prev) => !prev)}
                      >
                        {fullScreen ? "Exit fullscreen" : "Open fullscreen"}
                      </Button>
                    </Group>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {meeting.dateLabel} | {meeting.durationLabel} |{" "}
                    {meeting.channel}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    {meeting.tags.map((tag) => (
                      <Badge key={tag} variant="light" color="gray">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                </Stack>

                <Surface p="md" tone="soft">
                  <Group gap="sm" align="center" wrap="wrap">
                    <ThemeIcon variant="light" color="cyan">
                      <IconMicrophone size={16} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text fw={600}>Audio</Text>
                      <Text size="sm" c="dimmed">
                        Playback for the full recording.
                      </Text>
                    </Stack>
                  </Group>
                  <Divider my="sm" />
                  {meeting.audioUrl ? (
                    <audio
                      controls
                      preload="none"
                      style={{ width: "100%" }}
                      src={meeting.audioUrl}
                    />
                  ) : (
                    <Text size="sm" c="dimmed">
                      Audio isn’t available for this meeting yet.
                    </Text>
                  )}
                </Surface>

                <Surface p="md">
                  <Group gap="xs" mb="xs">
                    <ThemeIcon variant="light" color="brand">
                      <IconNote size={16} />
                    </ThemeIcon>
                    <Text fw={600}>Summary</Text>
                  </Group>
                  {meeting.summaryLabel ? (
                    <Text size="xs" c="dimmed" mb={6}>
                      {meeting.summaryLabel}
                    </Text>
                  ) : null}
                  <Text size="sm" c="dimmed">
                    {meeting.summary}
                  </Text>
                  <Divider my="sm" />
                  <ScrollArea h={fullScreen ? 260 : 200} offsetScrollbars>
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                      {meeting.notes}
                    </Text>
                  </ScrollArea>
                </Surface>

                <Surface p="md">
                  <Group gap="xs" mb="xs">
                    <ThemeIcon variant="light" color="cyan">
                      <IconUsers size={16} />
                    </ThemeIcon>
                    <Text fw={600}>Attendees</Text>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {meeting.attendees.join(", ")}
                  </Text>
                </Surface>

                <Surface p="md">
                  <Group
                    justify="space-between"
                    align="center"
                    mb="sm"
                    wrap="wrap"
                  >
                    <Group gap="sm">
                      <ThemeIcon variant="light" color="brand">
                        <IconFilter size={16} />
                      </ThemeIcon>
                      <Text fw={600}>Timeline</Text>
                    </Group>
                    <Group gap="xs">
                      {FILTER_OPTIONS.map((filter) => {
                        const isActive = activeFilters.includes(filter.value);
                        return (
                          <Button
                            key={filter.value}
                            size="xs"
                            variant={isActive ? "light" : "subtle"}
                            color={isActive ? "cyan" : "gray"}
                            onClick={() => {
                              setActiveFilters((current) =>
                                current.includes(filter.value)
                                  ? current.filter(
                                      (value) => value !== filter.value,
                                    )
                                  : [...current, filter.value],
                              );
                            }}
                          >
                            {filter.label}
                          </Button>
                        );
                      })}
                    </Group>
                  </Group>
                  <ScrollArea h={fullScreen ? 620 : 360} offsetScrollbars>
                    {visibleEvents.length === 0 ? (
                      <Center py="xl">
                        <Text size="sm" c="dimmed">
                          Timeline data will appear after the meeting finishes
                          processing.
                        </Text>
                      </Center>
                    ) : (
                      <Stack gap={0}>
                        {visibleEvents.map((event) => {
                          const meta = EVENT_META[event.type];
                          const Icon = meta.icon;
                          const showMetaLabel = Boolean(event.speaker);
                          return (
                            <Box
                              key={event.id}
                              px="sm"
                              py="sm"
                              style={{
                                borderBottom: `1px solid ${
                                  isDark
                                    ? theme.colors.dark[5]
                                    : theme.colors.gray[2]
                                }`,
                              }}
                            >
                              <Group gap="sm" align="flex-start" wrap="nowrap">
                                <ThemeIcon
                                  variant="light"
                                  color={meta.color}
                                  size={32}
                                >
                                  <Icon size={16} />
                                </ThemeIcon>
                                <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                                  <Group gap="xs" align="baseline" wrap="wrap">
                                    <Text fw={700} size="sm">
                                      {event.speaker ?? meta.label}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      {event.time}
                                    </Text>
                                    {showMetaLabel ? (
                                      <Text size="xs" c="dimmed">
                                        • {meta.label}
                                      </Text>
                                    ) : null}
                                  </Group>
                                  <Text size="sm" c="dimmed">
                                    {event.text}
                                  </Text>
                                </Stack>
                              </Group>
                            </Box>
                          );
                        })}
                      </Stack>
                    )}
                  </ScrollArea>
                </Surface>
              </Stack>
            ) : null}
          </Box>
        ) : null}
      </Drawer>
    </Stack>
  );
}
