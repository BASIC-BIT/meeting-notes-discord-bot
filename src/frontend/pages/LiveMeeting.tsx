import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Title,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import {
  IconMicrophone,
  IconRefresh,
  IconSpeakerphone,
  IconSparkles,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { useParams } from "@tanstack/react-router";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import { buildApiUrl } from "../services/apiClient";
import { useAuth } from "../contexts/AuthContext";
import type {
  LiveMeetingInitPayload,
  LiveMeetingMeta,
  LiveMeetingSegment,
  LiveMeetingSegmentsPayload,
  LiveMeetingStatusPayload,
} from "../../types/liveMeeting";

const SOURCE_META = {
  voice: { color: "brand", label: "Voice", icon: IconMicrophone },
  chat_tts: { color: "teal", label: "Spoken chat", icon: IconSpeakerphone },
  bot: { color: "violet", label: "Chronote", icon: IconSparkles },
} as const;

const formatElapsed = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      secs,
    ).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
};

const resolveSpeakerLabel = (segment: LiveMeetingSegment) => {
  if (segment.source === "bot") {
    return "Chronote";
  }
  return (
    segment.serverNickname ||
    segment.displayName ||
    segment.username ||
    segment.tag ||
    "Unknown"
  );
};

const buildLoginUrl = () => {
  const base = buildApiUrl("/auth/discord");
  if (typeof window === "undefined") {
    return base;
  }
  return `${base}?redirect=${encodeURIComponent(window.location.href)}`;
};

export default function LiveMeeting() {
  const params = useParams({
    from: "/live/$guildId/$meetingId",
  });
  const { state: authState, loading: authLoading } = useAuth();
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  const [meeting, setMeeting] = useState<LiveMeetingMeta | null>(null);
  const [segments, setSegments] = useState<LiveMeetingSegment[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "live" | "complete" | "error"
  >("connecting");
  const [autoScroll, setAutoScroll] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const meetingStartMs = useMemo(() => {
    if (!meeting) return null;
    const value = Date.parse(meeting.startedAt);
    return Number.isFinite(value) ? value : null;
  }, [meeting]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    const url = buildApiUrl(
      `/api/live/${params.guildId}/${params.meetingId}/stream`,
    );
    const source = new EventSource(url, { withCredentials: true });
    setStatus("connecting");
    source.addEventListener("init", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingInitPayload;
      setMeeting(payload.meeting);
      seenRef.current = new Set(payload.segments.map((seg) => seg.id));
      setSegments(payload.segments);
      setStatus(payload.meeting.status === "complete" ? "complete" : "live");
    });
    source.addEventListener("segments", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingSegmentsPayload;
      const next = payload.segments.filter((segment) => {
        if (seenRef.current.has(segment.id)) return false;
        seenRef.current.add(segment.id);
        return true;
      });
      if (next.length > 0) {
        setSegments((current) => [...current, ...next]);
      }
    });
    source.addEventListener("status", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingStatusPayload;
      if (payload.status === "complete") {
        setStatus("complete");
      }
    });
    source.onerror = () => {
      setStatus((current) => (current === "complete" ? current : "error"));
      source.close();
    };
    return () => {
      source.close();
    };
  }, [authState, params.guildId, params.meetingId, retryKey]);

  useEffect(() => {
    if (!autoScroll) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [segments, autoScroll]);

  if (authState === "unauthenticated") {
    return (
      <Stack gap="lg" data-testid="live-meeting-page">
        <PageHeader
          title="Live meeting"
          description="Sign in to view the live transcript."
        />
        <Surface p="lg">
          <Stack gap="sm" align="center">
            <Text size="sm" c="dimmed" ta="center">
              This live transcript requires Discord sign in with access to the
              voice channel.
            </Text>
            <Button component="a" href={buildLoginUrl()}>
              Sign in with Discord
            </Button>
          </Stack>
        </Surface>
      </Stack>
    );
  }

  if (authState === "unknown" || authLoading) {
    return (
      <Center py="xl">
        <Stack gap="xs" align="center">
          <Loader color="brand" />
          <Text c="dimmed">Checking sign in status...</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Stack gap="lg" data-testid="live-meeting-page">
      <PageHeader
        title="Live meeting"
        description="Live transcript updates as the meeting progresses."
      />
      <Surface p="lg">
        <Group justify="space-between" align="center" wrap="wrap">
          <Stack gap={4}>
            <Group gap="xs" align="center" wrap="wrap">
              <Title order={3}>
                {meeting ? `#${meeting.channelName}` : "Loading meeting..."}
              </Title>
              {status === "live" ? (
                <Badge color="red" variant="light">
                  Live
                </Badge>
              ) : status === "complete" ? (
                <Badge color="gray" variant="light">
                  Complete
                </Badge>
              ) : null}
            </Group>
            <Text size="sm" c="dimmed">
              {meeting
                ? `Started ${format(new Date(meeting.startedAt), "PPpp")}`
                : "Connecting to live stream..."}
            </Text>
          </Stack>
          <Group gap="sm" align="center">
            <Switch
              label="Auto-scroll"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.currentTarget.checked)}
            />
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              onClick={() => setRetryKey((current) => current + 1)}
            >
              Retry
            </Button>
          </Group>
        </Group>
        <Divider my="sm" />
        {status === "error" ? (
          <Center py="xl">
            <Text size="sm" c="dimmed">
              Unable to connect. Check your access to the voice channel and try
              again.
            </Text>
          </Center>
        ) : null}
        <ScrollArea h={520} viewportRef={viewportRef} offsetScrollbars>
          {segments.length === 0 ? (
            <Center py="xl">
              <Text size="sm" c="dimmed">
                Waiting for the first transcript line...
              </Text>
            </Center>
          ) : (
            <Stack gap={0}>
              {segments.map((segment) => {
                const meta = SOURCE_META[segment.source];
                const Icon = meta.icon;
                const elapsed = meetingStartMs
                  ? (Date.parse(segment.startedAt) - meetingStartMs) / 1000
                  : 0;
                return (
                  <Box
                    key={segment.id}
                    px="sm"
                    py="sm"
                    style={{
                      borderBottom: `1px solid ${
                        isDark ? theme.colors.dark[5] : theme.colors.gray[2]
                      }`,
                    }}
                  >
                    <Group gap="sm" align="flex-start" wrap="nowrap">
                      <ThemeIcon variant="light" color={meta.color} size={32}>
                        <Icon size={16} />
                      </ThemeIcon>
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" align="baseline" wrap="wrap">
                          <Text fw={700} size="sm">
                            {resolveSpeakerLabel(segment)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatElapsed(elapsed)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {meta.label}
                          </Text>
                        </Group>
                        <Text size="sm" c="dimmed">
                          {segment.text}
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
  );
}
