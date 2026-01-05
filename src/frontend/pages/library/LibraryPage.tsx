import { useState } from "react";
import { Group, Stack, Text } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import PageHeader from "../../components/PageHeader";
import { RefreshButton } from "../../components/RefreshButton";
import { useGuildContext } from "../../contexts/GuildContext";
import { FiltersBar } from "../../features/library/FiltersBar";
import { MeetingList } from "../../features/library/MeetingList";
import MeetingDetailDrawer from "./components/MeetingDetailDrawer";
import { useLibraryMeetings } from "./hooks/useLibraryMeetings";
import type { ArchiveFilter } from "./types";

export default function LibraryPage() {
  const navigate = useNavigate({ from: "/portal/server/$serverId/library" });
  const search = useSearch({ from: "/portal/server/$serverId/library" });
  const { guilds, selectedGuildId } = useGuildContext();
  const canManageSelectedGuild =
    selectedGuildId != null &&
    guilds.find((guild) => guild.id === selectedGuildId)?.canManage === true;

  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRange, setSelectedRange] = useState("30");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");

  const selectedMeetingId = search.meetingId ?? null;

  const {
    filteredMeetings,
    tagOptions,
    channelOptions,
    channelNameMap,
    listLoading,
    listError,
    invalidateMeetingLists,
    handleRefresh,
  } = useLibraryMeetings({
    selectedGuildId: selectedGuildId ?? null,
    archiveFilter,
    query,
    selectedTags,
    selectedChannel,
    selectedRange,
  });

  return (
    <Stack gap="lg" data-testid="library-page">
      <PageHeader
        title="Library"
        description="Every session, indexed by tags, channel, and timeline."
      />

      <FiltersBar
        query={query}
        onQueryChange={setQuery}
        tagOptions={tagOptions}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        selectedRange={selectedRange}
        onRangeChange={(value) => setSelectedRange(value)}
        archiveFilter={archiveFilter}
        onArchiveFilterChange={setArchiveFilter}
        selectedChannel={selectedChannel}
        onChannelChange={setSelectedChannel}
        channelOptions={channelOptions}
      />

      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="sm" align="center" wrap="wrap">
          <Text c="dimmed" size="sm">
            {filteredMeetings.length}{" "}
            {archiveFilter === "archived" ? "archived meetings" : "meetings"}
          </Text>
        </Group>
        <Group gap="xs" align="center">
          <Text size="xs" c="dimmed">
            Sorted by recency |{" "}
            {selectedRange === "all"
              ? "All time"
              : `Range: ${selectedRange} days`}
          </Text>
          <RefreshButton
            onClick={handleRefresh}
            size="xs"
            variant="subtle"
            data-testid="library-refresh-top"
          />
        </Group>
      </Group>
      <MeetingList
        items={filteredMeetings}
        listLoading={listLoading}
        listError={listError}
        onSelect={(meetingId) =>
          navigate({
            search: (prev) => ({
              ...prev,
              meetingId,
            }),
          })
        }
        selectedMeetingId={selectedMeetingId}
      />
      <Group justify="flex-end">
        <RefreshButton
          onClick={handleRefresh}
          size="xs"
          variant="subtle"
          data-testid="library-refresh"
        />
      </Group>

      <MeetingDetailDrawer
        opened={Boolean(selectedMeetingId)}
        selectedMeetingId={selectedMeetingId}
        selectedGuildId={selectedGuildId ?? null}
        canManageSelectedGuild={canManageSelectedGuild}
        channelNameMap={channelNameMap}
        invalidateMeetingLists={invalidateMeetingLists}
        onClose={() =>
          navigate({
            search: (prev) => ({
              ...prev,
              meetingId: undefined,
            }),
          })
        }
      />
    </Stack>
  );
}
