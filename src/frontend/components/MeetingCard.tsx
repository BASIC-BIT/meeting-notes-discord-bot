import { Badge, Button, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCalendar, IconClock, IconChevronRight } from "@tabler/icons-react";
import Surface from "./Surface";

export type MeetingCardData = {
  id: string;
  title: string;
  summary: string;
  dateLabel: string;
  durationLabel: string;
  tags: string[];
  channel: string;
};

type MeetingCardProps = {
  meeting: MeetingCardData;
  onOpen: (id: string) => void;
};

export function MeetingCard({ meeting, onOpen }: MeetingCardProps) {
  return (
    <Surface p="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Text fw={600}>{meeting.title}</Text>
            <Text c="dimmed" size="sm">
              {meeting.channel}
            </Text>
          </Stack>
          <Button
            size="xs"
            variant="light"
            rightSection={<IconChevronRight size={14} />}
            onClick={() => onOpen(meeting.id)}
          >
            View
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          {meeting.summary}
        </Text>
        <Group gap="xs">
          <Group gap={6}>
            <ThemeIcon size={22} radius="xl" variant="light" color="gray">
              <IconCalendar size={12} />
            </ThemeIcon>
            <Text size="xs" c="dimmed">
              {meeting.dateLabel}
            </Text>
          </Group>
          <Group gap={6}>
            <ThemeIcon size={22} radius="xl" variant="light" color="gray">
              <IconClock size={12} />
            </ThemeIcon>
            <Text size="xs" c="dimmed">
              {meeting.durationLabel}
            </Text>
          </Group>
        </Group>
        <Group gap="xs" wrap="wrap">
          {meeting.tags.map((tag) => (
            <Badge key={tag} variant="light" color="gray">
              {tag}
            </Badge>
          ))}
        </Group>
      </Stack>
    </Surface>
  );
}

export default MeetingCard;
