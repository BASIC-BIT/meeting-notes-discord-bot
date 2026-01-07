import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Drawer,
  Grid,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconArchiveOff,
  IconCopy,
  IconDownload,
  IconFilter,
  IconMicrophone,
  IconNote,
  IconPencil,
  IconThumbDown,
  IconThumbUp,
  IconUsers,
} from "@tabler/icons-react";
import MeetingTimeline, {
  MEETING_TIMELINE_FILTERS,
} from "../../../components/MeetingTimeline";
import MarkdownBody from "../../../components/MarkdownBody";
import Surface from "../../../components/Surface";
import { trpc } from "../../../services/trpc";
import { uiOverlays } from "../../../uiTokens";
import {
  endLiveMeeting,
  fetchLiveMeetingStatus,
} from "../../../services/liveMeetingControl";
import { formatDateTimeLabel } from "../../../utils/meetingLibrary";
import {
  MEETING_STATUS,
  type MeetingStatus,
} from "../../../../types/meetingLifecycle";
import type {
  MeetingEvent,
  MeetingEventType,
} from "../../../../types/meetingTimeline";
import { useMeetingDetail } from "../hooks/useMeetingDetail";

const resolveRenameDraft = (meeting: {
  meetingName?: string;
  summaryLabel?: string;
}) => {
  if (meeting.meetingName != null && meeting.meetingName !== "") {
    return meeting.meetingName;
  }
  if (meeting.summaryLabel != null && meeting.summaryLabel !== "") {
    return meeting.summaryLabel;
  }
  return "";
};

const normalizeOptionalString = (
  value: string | null | undefined,
): string | undefined => (value == null ? undefined : value);

const renderDetailStatusBadge = (status?: MeetingStatus) => {
  switch (status) {
    case MEETING_STATUS.IN_PROGRESS:
      return (
        <Badge color="red" variant="light">
          Live transcript
        </Badge>
      );
    case MEETING_STATUS.PROCESSING:
      return (
        <Badge color="yellow" variant="light">
          Processing
        </Badge>
      );
    default:
      return null;
  }
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
    archivedAt?: string;
    attendees: string[];
    events: MeetingEvent[];
    title: string;
    meetingName?: string;
    summary: string;
    summaryLabel?: string;
    summarySentence?: string;
    dateLabel: string;
    durationLabel: string;
    channel: string;
  };
};

type MeetingDetailDrawerProps = {
  opened: boolean;
  selectedMeetingId: string | null;
  selectedGuildId: string | null;
  canManageSelectedGuild: boolean;
  channelNameMap: Map<string, string>;
  invalidateMeetingLists: () => Promise<void>;
  onClose: () => void;
};

type ViewportTestIdProps = HTMLAttributes<HTMLDivElement> & {
  "data-testid": string;
};

const summaryViewportProps: ViewportTestIdProps = {
  "data-testid": "meeting-summary-scroll-viewport",
};

const timelineViewportProps: ViewportTestIdProps = {
  "data-testid": "meeting-timeline-scroll-viewport",
};

export default function MeetingDetailDrawer({
  opened,
  selectedMeetingId,
  selectedGuildId,
  canManageSelectedGuild,
  channelNameMap,
  invalidateMeetingLists,
  onClose,
}: MeetingDetailDrawerProps) {
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  const drawerOffset = theme.spacing.sm;
  const trpcUtils = trpc.useUtils();

  const [activeFilters, setActiveFilters] = useState<MeetingEventType[]>(
    MEETING_TIMELINE_FILTERS.map((filter) => filter.value),
  );
  const [fullScreen, setFullScreen] = useState(false);
  const [endMeetingModalOpen, setEndMeetingModalOpen] = useState(false);
  const [endMeetingLoading, setEndMeetingLoading] = useState(false);
  const [endMeetingPreflightLoading, setEndMeetingPreflightLoading] =
    useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveNextState, setArchiveNextState] = useState<boolean | null>(
    null,
  );
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [summaryFeedback, setSummaryFeedback] = useState<"up" | "down" | null>(
    null,
  );
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState("");

  const {
    detail,
    meeting,
    detailLoading,
    detailError,
    liveStreamEnabled,
    liveStream,
    displayStatus,
    displayAttendees,
    displayEvents,
    timelineEmptyLabel,
  } = useMeetingDetail({
    selectedGuildId,
    selectedMeetingId,
    channelNameMap,
    invalidateMeetingLists,
  });

  const archiveMutation = trpc.meetings.setArchived.useMutation();
  const renameMutation = trpc.meetings.rename.useMutation();
  const feedbackMutation = trpc.feedback.submitSummary.useMutation();

  const summaryCopyText = detail?.notes ?? "";
  const canCopySummary = summaryCopyText.trim().length > 0;

  const drawerTitle = meeting ? (
    <Group gap="xs" align="center" wrap="wrap">
      <Text fw={600} size="lg">
        {meeting.title}
      </Text>
      <ActionIcon
        variant="subtle"
        aria-label="Rename meeting"
        onClick={() => setRenameModalOpen(true)}
      >
        <IconPencil size={16} />
      </ActionIcon>
      {meeting.archivedAt ? (
        <Badge size="sm" variant="light" color="gray">
          Archived
        </Badge>
      ) : null}
      {renderDetailStatusBadge(displayStatus)}
    </Group>
  ) : (
    <Text fw={600} size="lg">
      Meeting details
    </Text>
  );

  useEffect(() => {
    if (!meeting) return;
    setRenameDraft(resolveRenameDraft(meeting));
    setRenameError(null);
    setSummaryFeedback(meeting.summaryFeedback ?? null);
    setFeedbackDraft("");
    setFeedbackModalOpen(false);
  }, [meeting]);

  const resetDrawerState = () => {
    setFullScreen(false);
    setEndMeetingModalOpen(false);
    setArchiveModalOpen(false);
    setArchiveNextState(null);
    setRenameModalOpen(false);
    setFeedbackModalOpen(false);
    setFeedbackDraft("");
  };

  const handleCloseDrawer = () => {
    resetDrawerState();
    onClose();
  };

  const preflightEndMeeting = async () => {
    if (!selectedGuildId || !meeting?.meetingId) return;
    try {
      setEndMeetingPreflightLoading(true);
      const status = await fetchLiveMeetingStatus(
        selectedGuildId,
        meeting.meetingId,
      );
      if (status.status !== MEETING_STATUS.IN_PROGRESS) {
        notifications.show({
          color: "gray",
          message: "Meeting is no longer live.",
        });
        return;
      }
      setEndMeetingModalOpen(true);
    } catch {
      notifications.show({
        color: "red",
        message: "Unable to refresh meeting status.",
      });
    } finally {
      setEndMeetingPreflightLoading(false);
    }
  };

  const handleConfirmEndMeeting = async () => {
    if (!selectedGuildId || !meeting?.meetingId) return;
    try {
      setEndMeetingLoading(true);
      await endLiveMeeting(selectedGuildId, meeting.meetingId);
      notifications.show({
        color: "green",
        message: "Ending meeting. Notes will arrive shortly.",
      });
      setEndMeetingModalOpen(false);
      if (liveStreamEnabled) {
        liveStream.retry();
      }
    } catch {
      notifications.show({
        color: "red",
        message: "Unable to end meeting. Please try again.",
      });
    } finally {
      setEndMeetingLoading(false);
    }
  };

  const handleArchiveToggle = async (archived: boolean): Promise<boolean> => {
    if (!selectedGuildId || !meeting) return false;
    try {
      await archiveMutation.mutateAsync({
        serverId: selectedGuildId,
        meetingId: meeting.id,
        archived,
      });
      notifications.show({
        color: "green",
        message: archived
          ? "Meeting archived. You can find it in the Archived view."
          : "Meeting unarchived.",
      });
      await Promise.all([
        invalidateMeetingLists(),
        trpcUtils.meetings.detail.invalidate(),
      ]);
      handleCloseDrawer();
      return true;
    } catch {
      notifications.show({
        color: "red",
        message: "Unable to update archive state. Please try again.",
      });
      return false;
    }
  };

  const handleArchiveConfirm = async () => {
    if (archiveNextState === null) return;
    const ok = await handleArchiveToggle(archiveNextState);
    if (!ok) return;
    setArchiveModalOpen(false);
    setArchiveNextState(null);
  };

  const handleRenameSave = async () => {
    if (!selectedGuildId || !meeting) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenameError("Meeting name cannot be empty.");
      return;
    }
    setRenameError(null);
    try {
      const result = await renameMutation.mutateAsync({
        serverId: selectedGuildId,
        meetingId: meeting.id,
        meetingName: trimmed,
      });
      notifications.show({
        color: "green",
        message: `Meeting renamed to ${result.meetingName}.`,
      });
      setRenameModalOpen(false);
      setRenameDraft(result.meetingName);
      await Promise.all([
        invalidateMeetingLists(),
        trpcUtils.meetings.detail.invalidate(),
      ]);
    } catch {
      setRenameError(
        renameMutation.error?.message ?? "Unable to rename meeting.",
      );
    }
  };

  const submitSummaryFeedback = async (
    rating: "up" | "down",
    comment?: string,
  ) => {
    if (!selectedGuildId || !meeting) return;
    try {
      await feedbackMutation.mutateAsync({
        serverId: selectedGuildId,
        meetingId: meeting.id,
        rating,
        comment: comment?.trim() || undefined,
      });
      setSummaryFeedback(rating);
      await trpcUtils.meetings.detail.invalidate();
      notifications.show({
        color: "green",
        message: "Thanks for the feedback.",
      });
    } catch {
      notifications.show({
        color: "red",
        message: "Unable to submit feedback right now.",
      });
    }
  };

  const handleSummaryFeedbackUp = () => {
    if (feedbackMutation.isPending) return;
    void submitSummaryFeedback("up");
  };

  const handleSummaryFeedbackDown = () => {
    if (feedbackMutation.isPending) return;
    setFeedbackModalOpen(true);
  };

  const handleSummaryFeedbackSubmit = () => {
    void submitSummaryFeedback("down", feedbackDraft);
    setFeedbackModalOpen(false);
    setFeedbackDraft("");
  };

  const handleCopySummary = async () => {
    if (!canCopySummary) return;
    try {
      await navigator.clipboard.writeText(summaryCopyText);
      notifications.show({
        color: "green",
        message: "Summary copied to clipboard.",
      });
    } catch (err) {
      notifications.show({
        color: "red",
        message: "Unable to copy the summary. Please try again.",
      });
      console.error("Failed to copy summary", err);
    }
  };

  const handleDownload = () => {
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
        notesChannelId: normalizeOptionalString(detail.notesChannelId),
        notesMessageId: normalizeOptionalString(detail.notesMessageId),
        transcript: detail.transcript ?? "",
        audioUrl: normalizeOptionalString(detail.audioUrl),
        archivedAt: normalizeOptionalString(detail.archivedAt),
        attendees: detail.attendees ?? [],
        events: detail.events ?? [],
        title: meeting.title,
        meetingName: meeting.meetingName,
        summary: meeting.summary,
        summarySentence: normalizeOptionalString(detail.summarySentence),
        summaryLabel: normalizeOptionalString(detail.summaryLabel),
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
    link.download = `${meeting.title.replace(/[^\w-]+/g, "_") || "meeting"}-${meeting.dateLabel.replace(/\s+/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const audioSection = meeting ? (
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
          preload="metadata"
          style={{ width: "100%" }}
          src={meeting.audioUrl}
        />
      ) : (
        <Text size="sm" c="dimmed">
          Audio isn't available for this meeting yet.
        </Text>
      )}
    </Surface>
  ) : null;

  const summaryBody = meeting ? (
    <>
      <MarkdownBody content={meeting.summary} compact dimmed />
      <Divider my="sm" />
      <MarkdownBody content={meeting.notes} />
    </>
  ) : null;

  const summarySection = meeting ? (
    <Surface
      p="md"
      style={
        fullScreen
          ? undefined
          : {
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }
      }
    >
      <Group
        gap="sm"
        mb="xs"
        justify="space-between"
        align="center"
        wrap="wrap"
      >
        <Group gap="xs">
          <ThemeIcon variant="light" color="brand">
            <IconNote size={16} />
          </ThemeIcon>
          <Text fw={600}>Summary</Text>
        </Group>
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="xs" c="dimmed">
            Was this summary helpful?
          </Text>
          <ActionIcon
            variant={summaryFeedback === "up" ? "light" : "subtle"}
            color={summaryFeedback === "up" ? "teal" : "gray"}
            onClick={handleSummaryFeedbackUp}
            disabled={feedbackMutation.isPending}
            aria-label="Mark summary helpful"
          >
            <IconThumbUp size={14} />
          </ActionIcon>
          <ActionIcon
            variant={summaryFeedback === "down" ? "light" : "subtle"}
            color={summaryFeedback === "down" ? "red" : "gray"}
            onClick={handleSummaryFeedbackDown}
            disabled={feedbackMutation.isPending}
            aria-label="Mark summary needs work"
          >
            <IconThumbDown size={14} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={handleCopySummary}
            disabled={!canCopySummary}
            aria-label="Copy summary as Markdown"
          >
            <IconCopy size={14} />
          </ActionIcon>
        </Group>
      </Group>
      {fullScreen ? (
        summaryBody
      ) : (
        <ScrollArea
          style={{ flex: 1, minHeight: 0 }}
          offsetScrollbars
          data-visual-scroll
          data-testid="meeting-summary-scroll"
          viewportProps={summaryViewportProps}
        >
          <Stack gap="sm">{summaryBody}</Stack>
        </ScrollArea>
      )}
    </Surface>
  ) : null;

  const attendeesSection = meeting ? (
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
  ) : null;

  const fullScreenCallout = (
    <Surface p="md" tone="soft">
      <Stack gap="xs">
        <Text fw={600}>Full transcript</Text>
        <Text size="sm" c="dimmed">
          View the speaker timeline and transcript events in fullscreen.
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconFilter size={14} />}
          onClick={() => setFullScreen(true)}
        >
          Open fullscreen
        </Button>
      </Stack>
    </Surface>
  );

  return (
    <Drawer
      opened={opened}
      onClose={handleCloseDrawer}
      position="right"
      size={fullScreen ? "100%" : "xl"}
      offset={drawerOffset}
      overlayProps={uiOverlays.modal}
      title={drawerTitle}
      data-testid="meeting-drawer"
      styles={{
        content: {
          backgroundColor: isDark ? theme.colors.dark[7] : theme.white,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
        header: {
          backgroundColor: isDark ? theme.colors.dark[7] : theme.white,
        },
        body: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
      {selectedMeetingId ? (
        <Box
          data-testid="meeting-drawer-content"
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {detailError ? (
            <Center py="xl">
              <Text c="dimmed">Unable to load meeting details.</Text>
            </Center>
          ) : detailLoading ? (
            <Center py="xl">
              <Loader color="brand" />
            </Center>
          ) : meeting ? (
            <>
              <Modal
                opened={feedbackModalOpen}
                onClose={() => setFeedbackModalOpen(false)}
                title="Summary feedback"
                centered
              >
                <Stack gap="md">
                  <Textarea
                    label="What could be better? (optional)"
                    placeholder="Add detail that helps improve the summary."
                    value={feedbackDraft}
                    onChange={(event) =>
                      setFeedbackDraft(event.currentTarget.value)
                    }
                    minRows={4}
                    maxLength={1000}
                  />
                  <Group justify="flex-end">
                    <Button
                      variant="default"
                      onClick={() => setFeedbackModalOpen(false)}
                      disabled={feedbackMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      color="red"
                      onClick={handleSummaryFeedbackSubmit}
                      loading={feedbackMutation.isPending}
                    >
                      Send feedback
                    </Button>
                  </Group>
                </Stack>
              </Modal>
              <Modal
                opened={endMeetingModalOpen}
                onClose={() => setEndMeetingModalOpen(false)}
                title="End live meeting"
                centered
              >
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    This will stop recording and begin processing notes. Are you
                    sure you want to end the meeting?
                  </Text>
                  <Group justify="flex-end">
                    <Button
                      variant="default"
                      onClick={() => setEndMeetingModalOpen(false)}
                      disabled={endMeetingLoading}
                    >
                      Cancel
                    </Button>
                    <Button
                      color="red"
                      onClick={handleConfirmEndMeeting}
                      loading={endMeetingLoading}
                    >
                      End meeting
                    </Button>
                  </Group>
                </Stack>
              </Modal>
              <Modal
                opened={archiveModalOpen}
                onClose={() => {
                  setArchiveModalOpen(false);
                  setArchiveNextState(null);
                }}
                title={
                  archiveNextState ? "Archive meeting" : "Unarchive meeting"
                }
                centered
              >
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    {archiveNextState
                      ? "Archived meetings move to the Archived view. You can unarchive anytime."
                      : "This meeting will move back to the active list."}
                  </Text>
                  <Group justify="flex-end">
                    <Button
                      variant="default"
                      onClick={() => {
                        setArchiveModalOpen(false);
                        setArchiveNextState(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      color={archiveNextState ? "red" : "brand"}
                      onClick={handleArchiveConfirm}
                      loading={archiveMutation.isPending}
                      data-testid="meeting-archive-confirm"
                    >
                      {archiveNextState
                        ? "Archive meeting"
                        : "Unarchive meeting"}
                    </Button>
                  </Group>
                </Stack>
              </Modal>
              <Modal
                opened={renameModalOpen}
                onClose={() => setRenameModalOpen(false)}
                title="Rename meeting"
                centered
              >
                <Stack gap="md">
                  <TextInput
                    label="Meeting name"
                    description="5 words or fewer, letters and numbers only."
                    value={renameDraft}
                    onChange={(event) =>
                      setRenameDraft(event.currentTarget.value)
                    }
                    error={renameError ?? undefined}
                    data-testid="meeting-rename-input"
                  />
                  <Group justify="flex-end">
                    <Button
                      variant="default"
                      onClick={() => setRenameModalOpen(false)}
                      disabled={renameMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleRenameSave}
                      loading={renameMutation.isPending}
                    >
                      Save name
                    </Button>
                  </Group>
                </Stack>
              </Modal>
              <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
                <Stack gap={4}>
                  <Group justify="flex-end" align="center" wrap="wrap">
                    {displayStatus === MEETING_STATUS.IN_PROGRESS &&
                    canManageSelectedGuild ? (
                      <Button
                        color="red"
                        variant="light"
                        loading={endMeetingPreflightLoading}
                        onClick={preflightEndMeeting}
                      >
                        End meeting
                      </Button>
                    ) : null}
                    <Button
                      variant="light"
                      leftSection={<IconDownload size={16} />}
                      onClick={handleDownload}
                      data-testid="meeting-download"
                    >
                      Download
                    </Button>
                    <Button
                      variant="subtle"
                      leftSection={
                        meeting.archivedAt ? (
                          <IconArchiveOff size={16} />
                        ) : (
                          <IconArchive size={16} />
                        )
                      }
                      onClick={() => {
                        setArchiveNextState(!meeting.archivedAt);
                        setArchiveModalOpen(true);
                      }}
                      loading={archiveMutation.isPending}
                      data-testid={
                        meeting.archivedAt
                          ? "meeting-unarchive"
                          : "meeting-archive"
                      }
                    >
                      {meeting.archivedAt ? "Unarchive" : "Archive"}
                    </Button>
                    <Button
                      variant={fullScreen ? "outline" : "light"}
                      leftSection={<IconFilter size={16} />}
                      onClick={() => setFullScreen((prev) => !prev)}
                      data-testid="meeting-fullscreen-toggle"
                    >
                      {fullScreen ? "Exit fullscreen" : "Open fullscreen"}
                    </Button>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {meeting.dateLabel} | {meeting.durationLabel} |{" "}
                    {meeting.channel}
                  </Text>
                  {meeting.archivedAt ? (
                    <Text size="xs" c="dimmed">
                      Archived on {formatDateTimeLabel(meeting.archivedAt)}
                    </Text>
                  ) : null}
                  <Group gap="xs" wrap="wrap">
                    {meeting.tags.map((tag) => (
                      <Badge key={tag} variant="light" color="gray">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                </Stack>

                {fullScreen ? (
                  <Grid
                    gutter="lg"
                    style={{ flex: 1, minHeight: 0 }}
                    align="stretch"
                  >
                    <Grid.Col
                      span={{ base: 12, lg: 5 }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                      }}
                    >
                      <ScrollArea
                        style={{ flex: 1, minHeight: 0 }}
                        offsetScrollbars
                        data-visual-scroll
                      >
                        <Stack gap="md">
                          {audioSection}
                          {summarySection}
                          {attendeesSection}
                        </Stack>
                      </ScrollArea>
                    </Grid.Col>
                    <Grid.Col
                      span={{ base: 12, lg: 7 }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                      }}
                    >
                      <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
                        {liveStreamEnabled && liveStream.status === "error" ? (
                          <Text size="sm" c="dimmed">
                            Unable to connect to the live transcript. Try
                            refreshing.
                          </Text>
                        ) : null}
                        <Surface
                          p="md"
                          style={{
                            flex: 1,
                            minHeight: 0,
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                          }}
                        >
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
                            height="100%"
                            title="Transcript"
                            emptyLabel={timelineEmptyLabel}
                            viewportProps={timelineViewportProps}
                          />
                        </Surface>
                      </Stack>
                    </Grid.Col>
                  </Grid>
                ) : (
                  <Stack
                    gap="md"
                    style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
                  >
                    {audioSection}
                    {summarySection}
                    {attendeesSection}
                    {fullScreenCallout}
                  </Stack>
                )}
              </Stack>
            </>
          ) : null}
        </Box>
      ) : null}
    </Drawer>
  );
}
