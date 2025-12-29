import { useEffect, useMemo, useRef, useState } from "react";
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
  IconMicrophone,
  IconNote,
  IconRefresh,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import Surface from "../components/Surface";
import PageHeader from "../components/PageHeader";
import FormSelect from "../components/FormSelect";
import MeetingTimeline, {
  MEETING_TIMELINE_FILTERS,
} from "../components/MeetingTimeline";
import { trpc } from "../services/trpc";
import { useGuildContext } from "../contexts/GuildContext";
import { uiOverlays } from "../uiTokens";
import { useLiveMeetingStream } from "../hooks/useLiveMeetingStream";
import {
  buildMeetingDetails,
  deriveSummary,
  deriveTitle,
  filterMeetingItems,
  formatChannelLabel,
  formatDateLabel,
  formatDurationLabel,
} from "../utils/meetingLibrary";
import type {
  MeetingEvent,
  MeetingEventType,
} from "../../types/meetingTimeline";

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
  status?: "in_progress" | "processing" | "complete";
};

type MeetingListItem = MeetingSummaryRow & {
  title: string;
  summary: string;
  summaryLabel?: string;
  dateLabel: string;
  durationLabel: string;
  channelLabel: string;
};

export default function Library() {
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  const trpcUtils = trpc.useUtils();
  const navigate = useNavigate({ from: "/portal/server/$serverId/library" });
  const search = useSearch({ from: "/portal/server/$serverId/library" });

  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRange, setSelectedRange] = useState("30");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<MeetingEventType[]>(
    MEETING_TIMELINE_FILTERS.map((filter) => filter.value),
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
  const selectedMeetingId = search.meetingId ?? null;
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
      filterMeetingItems(meetingItems, {
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
  const liveStreamEnabled = Boolean(
    meeting &&
      selectedGuildId &&
      (meeting.status === "in_progress" || meeting.status === "processing"),
  );
  const liveStream = useLiveMeetingStream({
    guildId: selectedGuildId ?? "",
    meetingId: meeting?.meetingId ?? "",
    enabled: liveStreamEnabled,
  });
  const displayStatus =
    liveStream.meeting?.status ?? meeting?.status ?? "complete";
  const displayAttendees = liveStreamEnabled
    ? liveStream.attendees
    : (meeting?.attendees ?? []);
  const displayEvents = liveStreamEnabled
    ? liveStream.events
    : (meeting?.events ?? []);
  const timelineEmptyLabel = liveStreamEnabled
    ? liveStream.status === "processing"
      ? "Meeting finished. Waiting for notes and timeline updates."
      : "Waiting for the first transcript line..."
    : "Timeline data will appear after the meeting finishes processing.";

  const listLoading = meetingsQuery.isLoading || channelsQuery.isLoading;
  const listError = meetingsQuery.error ?? channelsQuery.error;
  const detailLoading = detailQuery.isLoading || detailQuery.isFetching;
  const [refreshing, setRefreshing] = useState(false);
  const refetchedMeetingRef = useRef<string | null>(null);

  const meetingKey = meeting?.id ?? null;
  useEffect(() => {
    if (!liveStreamEnabled) return;
    if (liveStream.status !== "complete") return;
    if (!selectedGuildId || !meetingKey) return;
    if (refetchedMeetingRef.current === meetingKey) return;
    refetchedMeetingRef.current = meetingKey;
    void trpcUtils.meetings.detail.invalidate();
    void trpcUtils.meetings.list.invalidate({ serverId: selectedGuildId });
  }, [
    liveStream.status,
    liveStreamEnabled,
    meetingKey,
    selectedGuildId,
    trpcUtils.meetings.detail,
    trpcUtils.meetings.list,
  ]);

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
                onClick={() => {
                  navigate({
                    search: (prev) => ({
                      ...prev,
                      meetingId: meetingItem.id,
                    }),
                  });
                }}
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
                      ) : meetingItem.status === "processing" ? (
                        <Badge color="yellow" variant="light">
                          Processing
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
          navigate({
            search: (prev) => ({ ...prev, meetingId: undefined }),
          });
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
                      {displayStatus === "in_progress" ? (
                        <Badge color="red" variant="light">
                          Live transcript
                        </Badge>
                      ) : displayStatus === "processing" ? (
                        <Badge color="yellow" variant="light">
                          Processing
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
                    {displayAttendees.join(", ")}
                  </Text>
                </Surface>

                <Surface p="md">
                  <Stack gap="sm">
                    {liveStreamEnabled && liveStream.status === "error" ? (
                      <Text size="sm" c="dimmed">
                        Unable to connect to the live transcript. Try
                        refreshing.
                      </Text>
                    ) : null}
                    <MeetingTimeline
                      events={displayEvents}
                      activeFilters={activeFilters}
                      onToggleFilter={(value) =>
                        setActiveFilters((current) =>
                          current.includes(value)
                            ? current.filter((filter) => filter !== value)
                            : [...current, value],
                        )
                      }
                      height={fullScreen ? 620 : 360}
                      emptyLabel={timelineEmptyLabel}
                    />
                  </Stack>
                </Surface>
              </Stack>
            ) : null}
          </Box>
        ) : null}
      </Drawer>
    </Stack>
  );
}
