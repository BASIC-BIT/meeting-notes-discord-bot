import { useCallback, useMemo } from "react";
import { trpc } from "../../../services/trpc";
import { useInvalidateMeetingLists } from "../../../hooks/useInvalidateMeetingLists";
import {
  deriveSummary,
  filterMeetingItems,
  formatChannelLabel,
  formatDateLabel,
  formatDurationLabel,
  resolveMeetingTitle,
} from "../../../utils/meetingLibrary";
import { resolveNowMs } from "../../../utils/now";
import type {
  ArchiveFilter,
  MeetingListItem,
  MeetingSummaryRow,
} from "../types";

type UseLibraryMeetingsParams = {
  selectedGuildId: string | null;
  archiveFilter: ArchiveFilter;
  query: string;
  selectedTags: string[];
  selectedChannel: string | null;
  selectedRange: string;
};

type UseLibraryMeetingsResult = {
  filteredMeetings: MeetingListItem[];
  tagOptions: string[];
  channelOptions: Array<{ value: string; label: string }>;
  channelNameMap: Map<string, string>;
  listLoading: boolean;
  listError: boolean;
  invalidateMeetingLists: () => Promise<void>;
  handleRefresh: () => Promise<void>;
};

export const useLibraryMeetings = (
  params: UseLibraryMeetingsParams,
): UseLibraryMeetingsResult => {
  const trpcUtils = trpc.useUtils();
  const meetingsQuery = trpc.meetings.list.useQuery(
    {
      serverId: params.selectedGuildId ?? "",
      limit: 50,
      archivedOnly: params.archiveFilter === "archived",
      includeArchived: params.archiveFilter === "all",
    },
    { enabled: Boolean(params.selectedGuildId) },
  );
  const channelsQuery = trpc.servers.channels.useQuery(
    { serverId: params.selectedGuildId ?? "" },
    { enabled: Boolean(params.selectedGuildId) },
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
      const title = resolveMeetingTitle({
        meetingName: meetingRow.meetingName,
        summaryLabel: meetingRow.summaryLabel,
        summarySentence: meetingRow.summarySentence,
        channelLabel,
      });
      const summary = deriveSummary(
        meetingRow.notes,
        meetingRow.summarySentence,
      );
      return {
        ...meetingRow,
        title,
        summary,
        dateLabel,
        durationLabel,
        channelLabel,
      };
    });
  }, [meetingRows, channelNameMap]);

  const nowMs = useMemo(() => resolveNowMs(), []);

  const filteredMeetings = useMemo(
    () =>
      filterMeetingItems(meetingItems, {
        query: params.query,
        selectedTags: params.selectedTags,
        selectedChannel: params.selectedChannel,
        selectedRange: params.selectedRange,
        nowMs,
      }),
    [
      meetingItems,
      params.query,
      params.selectedTags,
      params.selectedChannel,
      params.selectedRange,
      nowMs,
    ],
  );

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

  const listLoading = meetingsQuery.isLoading || channelsQuery.isLoading;
  const listError = Boolean(meetingsQuery.error ?? channelsQuery.error);

  const invalidateMeetingLists = useInvalidateMeetingLists(
    params.selectedGuildId,
  );

  const handleRefresh = useCallback(async () => {
    if (!params.selectedGuildId) return;
    await Promise.all([
      invalidateMeetingLists(),
      trpcUtils.meetings.detail.invalidate(),
      trpcUtils.servers.channels.invalidate({
        serverId: params.selectedGuildId,
      }),
    ]);
  }, [params.selectedGuildId, invalidateMeetingLists, trpcUtils]);

  return {
    filteredMeetings,
    tagOptions,
    channelOptions,
    channelNameMap,
    listLoading,
    listError,
    invalidateMeetingLists,
    handleRefresh,
  };
};
