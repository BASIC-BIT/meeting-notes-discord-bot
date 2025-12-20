import { useMemo, useState, type ComponentType } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
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
  IconSearch,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import Surface from "../components/Surface";
import EvidenceCard from "../components/EvidenceCard";
import MetricCard from "../components/MetricCard";
import PageHeader from "../components/PageHeader";
import FormSelect from "../components/FormSelect";

type MeetingEvent = {
  id: string;
  type: "voice" | "chat" | "presence" | "bot";
  time: string;
  speaker?: string;
  text: string;
};

type MeetingDetails = {
  id: string;
  title: string;
  summary: string;
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
};

const MEETINGS: MeetingDetails[] = [
  {
    id: "m1",
    title: "Staff sync — moderation + events",
    summary:
      "Reviewed the mod queue, planned the weekend event, and assigned follow-ups.",
    notes:
      "Highlights\n- Mod queue triage\n- Weekend event plan\n\nDecisions\n- Pin updated rules in #welcome\n- Host the event in #stage\n\nAction items\n- Kai: post signup form\n- Rin: draft announcement\n\nOpen questions\n- Confirm co-host availability",
    dateLabel: "Nov 18, 2025",
    durationLabel: "54 min",
    tags: ["staff", "mods", "events"],
    channel: "#staff-voice",
    audioUrl: null,
    attendees: ["Rin", "Jules", "Kai", "Rowan"],
    decisions: ["Pin updated rules in #welcome", "Host the event in #stage"],
    actions: ["Kai to post signup form", "Rin to draft announcement"],
    events: [
      {
        id: "e1",
        type: "presence",
        time: "00:00",
        speaker: "Rin",
        text: "joined the channel",
      },
      {
        id: "e2",
        type: "voice",
        time: "00:03",
        speaker: "Rin",
        text: "Mod queue is up again — let's split triage by timezone and close out the easy ones.",
      },
      {
        id: "e3",
        type: "voice",
        time: "05:12",
        speaker: "Jules",
        text: "If we pin the rules in #welcome, we can stop repeating them every day.",
      },
      {
        id: "e4",
        type: "chat",
        time: "12:10",
        speaker: "Kai",
        text: "Posting the signup form here.",
      },
      {
        id: "e5",
        type: "voice",
        time: "19:44",
        speaker: "Rowan",
        text: "Let's keep the event to 90 minutes and do Q&A at the end.",
      },
      {
        id: "e6",
        type: "bot",
        time: "52:30",
        text: "Meeting summary posted to #session-notes.",
      },
    ],
  },
  {
    id: "m2",
    title: "Campaign session - The Obsidian Gate",
    summary: "The party negotiated safe passage and uncovered the vault map.",
    notes:
      "Recap\n- Negotiated safe passage through the ridge\n- Uncovered the vault map and learned the gate glyphs match the monastery symbol\n\nDecisions\n- Return to the ridge at dawn\n\nAction items\n- Theo: summarize NPC names\n- Nyx: track loot",
    dateLabel: "Nov 16, 2025",
    durationLabel: "2h 08m",
    tags: ["rpg", "campaign", "session"],
    channel: "#tabletop-voice",
    audioUrl: null,
    attendees: ["Mira", "Theo", "Nyx", "Sage"],
    decisions: ["Return to the ridge at dawn."],
    actions: ["Theo to summarize NPC names", "Nyx to track loot"],
    events: [
      {
        id: "e7",
        type: "presence",
        time: "00:00",
        speaker: "Mira",
        text: "joined the channel",
      },
      {
        id: "e8",
        type: "voice",
        time: "12:08",
        speaker: "Mira",
        text: "We should trade the relic for the map, not the key.",
      },
      {
        id: "e9",
        type: "chat",
        time: "12:30",
        speaker: "Theo",
        text: "Rolling persuasion...",
      },
      {
        id: "e10",
        type: "voice",
        time: "41:22",
        speaker: "Sage",
        text: "The gate glyphs match the symbol from the monastery.",
      },
    ],
  },
  {
    id: "m3",
    title: "Raid night — progression",
    summary: "Cleared two bosses, planned Phase 2 strategy, and tracked loot.",
    notes:
      "Highlights\n- Cleared Gatekeeper + Archivist\n- Phase 2 needs tighter stack timing\n\nDecisions\n- Run two healers for Phase 2\n- Bring frost resist potions\n\nAction items\n- Rin: update loot sheet\n- Mira: post strat notes",
    dateLabel: "Nov 14, 2025",
    durationLabel: "1h 38m",
    tags: ["raid", "strats", "loot"],
    channel: "#raid-voice",
    audioUrl: null,
    attendees: ["Mira", "Rin", "Bryce"],
    decisions: ["Run two healers for Phase 2", "Bring frost resist potions"],
    actions: ["Rin to update loot sheet", "Mira to post strat notes"],
    events: [
      {
        id: "e11",
        type: "voice",
        time: "04:10",
        speaker: "Mira",
        text: "Phase 2: stack on blue, then spread on the call. Don't chase the add.",
      },
      {
        id: "e12",
        type: "chat",
        time: "30:12",
        speaker: "Bryce",
        text: "Posting the build + consumables list.",
      },
      {
        id: "e13",
        type: "bot",
        time: "96:40",
        text: "Meeting summary posted to #session-notes.",
      },
    ],
  },
];

const TAG_OPTIONS = Array.from(
  new Set(MEETINGS.flatMap((meeting) => meeting.tags)),
);
const CHANNEL_OPTIONS = Array.from(
  new Set(MEETINGS.map((meeting) => meeting.channel)),
);

const FILTER_OPTIONS = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "presence", label: "Joins/Leaves" },
  { value: "bot", label: "Bot" },
];

const EVENT_META: Record<
  MeetingEvent["type"],
  { color: string; label: string; icon: ComponentType<{ size?: number }> }
> = {
  voice: { color: "brand", label: "Voice", icon: IconMicrophone },
  chat: { color: "cyan", label: "Chat", icon: IconMessageCircle },
  presence: { color: "gray", label: "Join/leave", icon: IconUsers },
  bot: { color: "violet", label: "Chronote", icon: IconSparkles },
};

export default function Library() {
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";

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

  const meeting = useMemo(
    () => MEETINGS.find((m) => m.id === selectedMeetingId) || null,
    [selectedMeetingId],
  );

  const filtered = useMemo(() => {
    return MEETINGS.filter((m) => {
      if (query && !m.title.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      if (selectedTags.length) {
        return selectedTags.every((tag) => m.tags.includes(tag));
      }
      if (selectedChannel && m.channel !== selectedChannel) {
        return false;
      }
      return true;
    });
  }, [query, selectedTags, selectedChannel]);

  const visibleEvents = useMemo(() => {
    if (!meeting) return [];
    return meeting.events.filter((event) => activeFilters.includes(event.type));
  }, [meeting, activeFilters]);

  return (
    <Stack gap="xl">
      <PageHeader
        title="Library"
        description="Every session, indexed by tags, channel, and timeline."
      />

      <SimpleGrid cols={{ base: 1, md: 4 }} spacing="lg">
        <MetricCard
          label="Meetings (30d)"
          value="38"
          helper="Across 5 channels"
        />
        <MetricCard
          label="Minutes captured"
          value="1,124"
          helper="Last 30 days"
        />
        <MetricCard label="Active tags" value="14" helper="Across teams" />
        <MetricCard label="Live responses" value="21" helper="This week" />
      </SimpleGrid>

      <Surface p="lg" tone="soft">
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search meetings"
            leftSection={<IconSearch size={16} />}
          />
          <MultiSelect
            data={TAG_OPTIONS}
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
            data={CHANNEL_OPTIONS.map((channel) => ({
              value: channel,
              label: channel,
            }))}
            clearable
          />
        </SimpleGrid>
      </Surface>

      <Group justify="space-between" align="center" wrap="wrap">
        <Text c="dimmed" size="sm">
          {filtered.length} meetings
        </Text>
        <Text size="xs" c="dimmed">
          Sorted by recency •{" "}
          {selectedRange === "all"
            ? "All time"
            : `Range: ${selectedRange} days`}
        </Text>
      </Group>

      <Surface p={0}>
        <Stack gap={0}>
          {filtered.map((meetingItem, index) => (
            <Box
              key={meetingItem.id}
              px={{ base: "md", md: "lg" }}
              py="md"
              onClick={() => setSelectedMeetingId(meetingItem.id)}
              style={{
                cursor: "pointer",
                borderBottom:
                  index === filtered.length - 1
                    ? undefined
                    : `1px solid ${isDark ? theme.colors.dark[5] : theme.colors.gray[2]}`,
              }}
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={6} style={{ flex: 1 }}>
                  <Text fw={650}>{meetingItem.title}</Text>
                  <Text size="sm" c="dimmed">
                    {meetingItem.summary}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {meetingItem.dateLabel} • {meetingItem.durationLabel} •{" "}
                    {meetingItem.channel}
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
      </Surface>

      <Drawer
        opened={!!meeting}
        onClose={() => {
          setSelectedMeetingId(null);
          setFullScreen(false);
        }}
        position="right"
        size={fullScreen ? "100%" : "xl"}
        overlayProps={{ opacity: 0.3, blur: 2 }}
        styles={{
          content: {
            backgroundColor: isDark ? theme.colors.dark[7] : theme.white,
          },
        }}
      >
        {meeting ? (
          <Stack gap="md">
            <Stack gap={4}>
              <Group justify="space-between" align="center" wrap="wrap">
                <Title order={3}>{meeting.title}</Title>
                <Group gap="sm">
                  <Button
                    variant="light"
                    leftSection={<IconDownload size={16} />}
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
                <ThemeIcon variant="light" color="cyan" radius="md">
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
              <audio
                controls
                preload="none"
                style={{ width: "100%" }}
                src={meeting.audioUrl ?? undefined}
              />
            </Surface>

            <Surface p="md">
              <Group gap="xs" mb="xs">
                <ThemeIcon variant="light" color="brand" radius="md">
                  <IconNote size={16} />
                </ThemeIcon>
                <Text fw={600}>Summary</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {meeting.summary}
              </Text>
              <Divider my="sm" />
              <ScrollArea h={fullScreen ? 260 : 200} offsetScrollbars>
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {meeting.notes}
                </Text>
              </ScrollArea>
              <Divider my="sm" />
              {meeting.events.find((event) => event.type === "voice") ? (
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    Receipt
                  </Text>
                  {(() => {
                    const receipt = meeting.events.find(
                      (event) => event.type === "voice",
                    );
                    if (!receipt) return null;
                    return (
                      <EvidenceCard
                        quote={receipt.text}
                        speaker={receipt.speaker || "Unknown"}
                        time={receipt.time}
                        channel={meeting.channel}
                      />
                    );
                  })()}
                </Stack>
              ) : null}
            </Surface>

            <Surface p="md">
              <Group gap="xs" mb="xs">
                <ThemeIcon variant="light" color="cyan" radius="md">
                  <IconUsers size={16} />
                </ThemeIcon>
                <Text fw={600}>Attendees</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {meeting.attendees.join(", ")}
              </Text>
            </Surface>

            <Surface p="md">
              <Group justify="space-between" align="center" mb="sm" wrap="wrap">
                <Group gap="sm">
                  <ThemeIcon variant="light" color="brand" radius="md">
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
                            isDark ? theme.colors.dark[5] : theme.colors.gray[2]
                          }`,
                        }}
                      >
                        <Group gap="sm" align="flex-start" wrap="nowrap">
                          <ThemeIcon
                            variant="light"
                            color={meta.color}
                            radius="md"
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
              </ScrollArea>
            </Surface>
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}
