import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconChevronRight, IconFilter, IconUsers } from "@tabler/icons-react";
import Surface from "../../components/Surface";
import type { MeetingStatus } from "../../../types/meetingLifecycle";
import { MEETING_STATUS } from "../../../types/meetingLifecycle";
import type { MeetingListItem } from "../../pages/Library";

const renderListStatusBadge = (status?: MeetingStatus) => {
  switch (status) {
    case MEETING_STATUS.IN_PROGRESS:
      return (
        <Badge color="red" variant="light">
          Live
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

type MeetingListProps = {
  items: MeetingListItem[];
  listLoading: boolean;
  listError: boolean;
  onRefresh: () => void;
  onSelect: (meetingId: string) => void;
  selectedMeetingId: string | null;
};

export function MeetingList({
  items,
  listLoading,
  listError,
  onRefresh,
  onSelect,
  selectedMeetingId,
}: MeetingListProps) {
  return (
    <Surface p={0} style={{ position: "relative" }} data-testid="library-list">
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
      ) : items.length === 0 ? (
        <Center py="xl">
          <Stack gap="xs" align="center">
            <ThemeIcon variant="light" color="gray">
              <IconFilter size={16} />
            </ThemeIcon>
            <Text c="dimmed">No meetings match these filters yet.</Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap={0}>
          {items.map((meetingItem) => (
            <Box
              key={meetingItem.id}
              px={{ base: "md", md: "lg" }}
              py="md"
              onClick={() => onSelect(meetingItem.id)}
              style={{
                cursor: "pointer",
                backgroundColor:
                  selectedMeetingId === meetingItem.id
                    ? "var(--mantine-color-dark-6)"
                    : undefined,
              }}
              data-testid="library-meeting-row"
              data-meeting-id={meetingItem.id}
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" align="center">
                    <Text fw={600} truncate>
                      {meetingItem.title}
                    </Text>
                    {renderListStatusBadge(meetingItem.status)}
                  </Group>
                  <Text size="sm" c="dimmed" lineClamp={2}>
                    {meetingItem.summary || "No summary yet."}
                  </Text>
                  <Group gap="sm" align="center">
                    <Group gap={4} align="center">
                      <Text size="xs" c="dimmed">
                        {meetingItem.dateLabel} | {meetingItem.durationLabel}
                      </Text>
                    </Group>
                    <Group gap={4} align="center">
                      <IconUsers size={14} />
                      <Text size="xs" c="dimmed">
                        {meetingItem.channelLabel}
                      </Text>
                    </Group>
                    {meetingItem.tags.length ? (
                      <Text size="xs" c="dimmed">
                        Tags: {meetingItem.tags.join(", ")}
                      </Text>
                    ) : null}
                  </Group>
                </Stack>
                <ActionIcon variant="subtle" aria-label="Open details">
                  <IconChevronRight size={16} />
                </ActionIcon>
              </Group>
            </Box>
          ))}
        </Stack>
      )}
      <Group justify="flex-end" p="md">
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconFilter size={14} />}
          onClick={onRefresh}
          data-testid="library-refresh"
        >
          Refresh
        </Button>
      </Group>
    </Surface>
  );
}
