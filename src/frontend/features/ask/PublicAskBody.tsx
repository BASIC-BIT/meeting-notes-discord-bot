import {
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import type {
  AskConversation,
  AskMessage,
  AskSharedConversation,
} from "../../../types/ask";
import { AskMessageBubble } from "./AskMessageBubble";
import { uiSpacing } from "../../uiTokens";

type PublicAskBodyProps = {
  isLoading: boolean;
  hasError: boolean;
  conversation: AskConversation | null;
  messages: AskMessage[];
  sharedMeta: AskSharedConversation | null;
  highlightedMessageId: string | null;
};

export function PublicAskBody({
  isLoading,
  hasError,
  conversation,
  messages,
  sharedMeta,
  highlightedMessageId,
}: PublicAskBodyProps) {
  if (isLoading) {
    return (
      <Text size="sm" c="dimmed">
        Loading shared thread...
      </Text>
    );
  }
  if (!conversation || hasError) {
    return (
      <Text size="sm" c="dimmed">
        This shared thread is unavailable.
      </Text>
    );
  }

  return (
    <Stack gap="md">
      <Group gap="sm" align="center">
        <ThemeIcon variant="light" color="brand">
          <IconMessage size={16} />
        </ThemeIcon>
        <Text fw={600}>{conversation.title}</Text>
      </Group>
      <Text size="sm" c="dimmed">
        Shared by {sharedMeta?.ownerTag ?? "Unknown member"}
      </Text>
      <Divider />
      <ScrollArea
        style={{ minHeight: 240, maxHeight: "60vh" }}
        type="always"
        offsetScrollbars
        scrollbarSize={10}
        data-visual-scroll
        styles={{
          viewport: {
            paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
          },
        }}
      >
        <Stack gap="sm">
          {messages.map((message) => (
            <AskMessageBubble
              key={message.id}
              message={message}
              roleLabels={{ user: "Participant", chronote: "Chronote" }}
              highlighted={highlightedMessageId === message.id}
            />
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

export type { PublicAskBodyProps };
