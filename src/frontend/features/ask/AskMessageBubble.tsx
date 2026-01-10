import { ActionIcon, Group, Loader, Stack, Text } from "@mantine/core";
import { IconCopy, IconLink } from "@tabler/icons-react";
import Surface from "../../components/Surface";
import MarkdownBody, {
  type MarkdownLinkHandler,
} from "../../components/MarkdownBody";
import type { AskMessage } from "../../../types/ask";
import { formatTime } from "../../utils/askLinks";
import { uiColors, uiEffects, uiRadii } from "../../uiTokens";

type AskMessageBubbleProps = {
  message: AskMessage;
  roleLabels: { user: string; chronote: string };
  highlighted: boolean;
  showActions?: boolean;
  linkHandler?: MarkdownLinkHandler;
  onCopyLink?: (messageId: string) => void;
  onCopyResponse?: (text: string) => void;
};

export function AskMessageBubble({
  message,
  roleLabels,
  highlighted,
  showActions = false,
  linkHandler,
  onCopyLink,
  onCopyResponse,
}: AskMessageBubbleProps) {
  return (
    <Surface
      p="sm"
      tone={message.role === "chronote" ? "soft" : "default"}
      radius={uiRadii.bubble}
      data-testid="ask-message"
      data-role={message.role}
      data-message-id={message.id}
      style={{
        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        maxWidth: "88%",
        border: highlighted
          ? `1px solid ${uiColors.highlightBorderSoft}`
          : undefined,
        boxShadow: highlighted ? uiEffects.activeInset : undefined,
      }}
    >
      <Stack gap={6}>
        <Group gap="xs" justify="space-between">
          <Group gap="xs">
            <Text size="xs" c="dimmed" fw={600}>
              {message.role === "user" ? roleLabels.user : roleLabels.chronote}
            </Text>
            <Text size="xs" c="dimmed">
              {formatTime(message.createdAt)}
            </Text>
          </Group>
          {showActions ? (
            <Group gap="xs">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => onCopyLink?.(message.id)}
                aria-label="Copy message link"
              >
                <IconLink size={14} />
              </ActionIcon>
              {message.role === "chronote" ? (
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  onClick={() => onCopyResponse?.(message.text)}
                  aria-label="Copy response"
                >
                  <IconCopy size={14} />
                </ActionIcon>
              ) : null}
            </Group>
          ) : null}
        </Group>
        {message.id === "thinking" ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              {message.text}
            </Text>
          </Group>
        ) : message.role === "chronote" ? (
          <MarkdownBody
            content={message.text}
            compact
            linkHandler={linkHandler}
          />
        ) : (
          <Text size="sm">{message.text}</Text>
        )}
      </Stack>
    </Surface>
  );
}

export type { AskMessageBubbleProps };
