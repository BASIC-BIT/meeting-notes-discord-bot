import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import type { RefObject } from "react";
import type { ListMode } from "../../utils/askLinks";

type AskComposerProps = {
  listMode: ListMode;
  isArchived: boolean;
  askAccessAllowed: boolean;
  selectedGuildId: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onAsk: () => void;
  askPending: boolean;
  errorMessage: string | null;
  inputRef: RefObject<HTMLTextAreaElement>;
};

export function AskComposer({
  listMode,
  isArchived,
  askAccessAllowed,
  selectedGuildId,
  draft,
  onDraftChange,
  onAsk,
  askPending,
  errorMessage,
  inputRef,
}: AskComposerProps) {
  return (
    <Stack gap="sm">
      <Textarea
        placeholder={
          listMode === "shared"
            ? "Shared threads are read only."
            : isArchived
              ? "Archived chats are read only."
              : "Ask about decisions, action items, or what was discussed..."
        }
        minRows={3}
        value={draft}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        disabled={
          !selectedGuildId ||
          !askAccessAllowed ||
          listMode !== "mine" ||
          isArchived ||
          askPending
        }
        ref={inputRef}
        data-testid="ask-input"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void onAsk();
          }
        }}
      />
      {errorMessage ? (
        <Text size="xs" c="red">
          {errorMessage}
        </Text>
      ) : null}
      <Group justify="space-between" align="center" wrap="wrap">
        <Text size="xs" c="dimmed">
          Searches recent meetings by default. Press Ctrl+Enter to send.
        </Text>
        <Button
          variant="gradient"
          gradient={{ from: "brand", to: "violet" }}
          leftSection={<IconSparkles size={16} />}
          onClick={onAsk}
          disabled={
            !draft.trim() ||
            !selectedGuildId ||
            !askAccessAllowed ||
            listMode !== "mine" ||
            isArchived ||
            askPending
          }
          loading={askPending}
          data-testid="ask-send"
        >
          Ask
        </Button>
      </Group>
    </Stack>
  );
}

export type { AskComposerProps };
