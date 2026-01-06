import { Center, ScrollArea, Stack, Text } from "@mantine/core";
import type { RefObject } from "react";
import type { AskMessage } from "../../../types/ask";
import { type ListMode } from "../../utils/askLinks";
import { uiSpacing } from "../../uiTokens";
import { AskMessageBubble } from "./AskMessageBubble";

type AskMessageListProps = {
  askAccessAllowed: boolean;
  listMode: ListMode;
  sharingEnabled: boolean;
  conversationError: unknown;
  displayMessages: AskMessage[];
  highlightedMessageId: string | null;
  onCopyLink: (messageId?: string) => void;
  onCopyResponse: (text: string) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
};

export function AskMessageList({
  askAccessAllowed,
  listMode,
  sharingEnabled,
  conversationError,
  displayMessages,
  highlightedMessageId,
  onCopyLink,
  onCopyResponse,
  viewportRef,
}: AskMessageListProps) {
  return (
    <ScrollArea
      style={{ flex: 1, minHeight: 0 }}
      viewportRef={viewportRef}
      type="always"
      offsetScrollbars
      scrollbarSize={10}
      data-visual-scroll
      data-testid="ask-messages"
      styles={{
        viewport: {
          paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
        },
      }}
    >
      <Stack gap="sm">
        {!askAccessAllowed ? (
          <Center py="lg">
            <Text size="sm" c="dimmed">
              Ask access is disabled for members in this server.
            </Text>
          </Center>
        ) : listMode === "shared" && !sharingEnabled ? (
          <Center py="lg">
            <Text size="sm" c="dimmed">
              Sharing is disabled for this server.
            </Text>
          </Center>
        ) : conversationError ? (
          <Center py="lg">
            <Text size="sm" c="dimmed">
              Conversation unavailable.
            </Text>
          </Center>
        ) : displayMessages.length === 0 ? (
          <Center py="lg">
            <Text size="sm" c="dimmed">
              {listMode === "shared"
                ? "Select a shared conversation to view it."
                : "Start by asking about a recent meeting."}
            </Text>
          </Center>
        ) : (
          displayMessages.map((message) => (
            <AskMessageBubble
              key={message.id}
              message={message}
              roleLabels={{ user: "You", chronote: "Chronote" }}
              highlighted={highlightedMessageId === message.id}
              showActions
              onCopyLink={onCopyLink}
              onCopyResponse={onCopyResponse}
            />
          ))
        )}
      </Stack>
    </ScrollArea>
  );
}

export type { AskMessageListProps };
