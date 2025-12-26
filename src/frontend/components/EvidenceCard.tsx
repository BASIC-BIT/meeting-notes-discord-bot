import { Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconQuote } from "@tabler/icons-react";
import Surface from "./Surface";

type EvidenceCardProps = {
  quote: string;
  speaker: string;
  time?: string;
  meeting?: string;
  channel?: string;
};

export function EvidenceCard({
  quote,
  speaker,
  time,
  meeting,
  channel,
}: EvidenceCardProps) {
  const meta = [speaker, time, channel, meeting].filter(Boolean).join(" • ");
  return (
    <Surface p="md">
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" color="gray" size={34}>
          <IconQuote size={16} />
        </ThemeIcon>
        <Stack gap={6} style={{ flex: 1 }}>
          <Text size="sm">“{quote}”</Text>
          {meta ? (
            <Text size="xs" c="dimmed">
              {meta}
            </Text>
          ) : null}
        </Stack>
      </Group>
    </Surface>
  );
}

export default EvidenceCard;
