import {
  Badge,
  Button,
  Group,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArchive,
  IconArchiveOff,
  IconCheck,
  IconMessage,
  IconPencil,
  IconShare2,
  IconX,
} from "@tabler/icons-react";
import type {
  AskConversation,
  AskConversationVisibility,
} from "../../../types/ask";
import type { ListMode } from "../../utils/askLinks";
import { AskExportMenu } from "./AskExportMenu";

type AskConversationHeaderProps = {
  listMode: ListMode;
  activeConversation: AskConversation | null;
  displayTitle: string;
  isShared: boolean;
  shareDisplayVisibility: AskConversationVisibility;
  shareBadgeLabel: string;
  isArchived: boolean;
  shareActionDisabled: boolean;
  canExport: boolean;
  renaming: boolean;
  showRename: boolean;
  renameDraft: string;
  selectedGuildId: string | null;
  renameLoading: boolean;
  archiveLoading: boolean;
  onRenameDraftChange: (value: string) => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
  onShareOpen: () => void;
  onArchiveOpen: () => void;
  onExport: (format: "json" | "text") => void;
};

type AskConversationTitleProps = {
  displayTitle: string;
  isShared: boolean;
  shareDisplayVisibility: AskConversationVisibility;
  shareBadgeLabel: string;
  isArchived: boolean;
};

type AskConversationRenameInputProps = {
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
};

type AskConversationActionsProps = {
  listMode: ListMode;
  activeConversation: AskConversation | null;
  shareActionDisabled: boolean;
  isArchived: boolean;
  archiveLoading: boolean;
  canExport: boolean;
  showRename: boolean;
  renaming: boolean;
  selectedGuildId: string | null;
  renameLoading: boolean;
  onShareOpen: () => void;
  onArchiveOpen: () => void;
  onExport: (format: "json" | "text") => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
};

const AskConversationTitle = ({
  displayTitle,
  isShared,
  shareDisplayVisibility,
  shareBadgeLabel,
  isArchived,
}: AskConversationTitleProps) => (
  <Group gap="xs" align="center" wrap="wrap">
    <Text fw={600} data-testid="ask-title">
      {displayTitle}
    </Text>
    {isShared ? (
      <Badge
        size="xs"
        variant="light"
        color={shareDisplayVisibility === "public" ? "teal" : "cyan"}
      >
        {shareBadgeLabel}
      </Badge>
    ) : null}
    {isArchived ? (
      <Badge size="xs" variant="light" color="gray">
        Archived
      </Badge>
    ) : null}
  </Group>
);

const AskConversationRenameInput = ({
  renameDraft,
  onRenameDraftChange,
  onRenameSave,
  onRenameCancel,
}: AskConversationRenameInputProps) => (
  <TextInput
    value={renameDraft}
    onChange={(event) => onRenameDraftChange(event.currentTarget.value)}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void onRenameSave();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onRenameCancel();
      }
    }}
    size="sm"
    styles={{ input: { minWidth: 220 } }}
    data-testid="ask-rename-input"
  />
);

const AskConversationPrimaryActions = ({
  shareActionDisabled,
  isArchived,
  archiveLoading,
  canExport,
  onShareOpen,
  onArchiveOpen,
  onExport,
}: Pick<
  AskConversationActionsProps,
  | "shareActionDisabled"
  | "isArchived"
  | "archiveLoading"
  | "canExport"
  | "onShareOpen"
  | "onArchiveOpen"
  | "onExport"
>) => (
  <>
    <Button
      size="xs"
      variant="subtle"
      leftSection={<IconShare2 size={14} />}
      onClick={onShareOpen}
      disabled={shareActionDisabled}
      data-testid="ask-share"
    >
      Share
    </Button>
    <Button
      size="xs"
      variant="subtle"
      leftSection={
        isArchived ? <IconArchiveOff size={14} /> : <IconArchive size={14} />
      }
      onClick={onArchiveOpen}
      loading={archiveLoading}
      data-testid={isArchived ? "ask-unarchive" : "ask-archive"}
    >
      {isArchived ? "Unarchive" : "Archive"}
    </Button>
    <AskExportMenu disabled={!canExport} onExport={onExport} />
  </>
);

const AskConversationRenameAction = ({
  showRename,
  renaming,
  selectedGuildId,
  renameLoading,
  onRenameSave,
  onRenameCancel,
  onRenameStart,
}: Pick<
  AskConversationActionsProps,
  | "showRename"
  | "renaming"
  | "selectedGuildId"
  | "renameLoading"
  | "onRenameSave"
  | "onRenameCancel"
  | "onRenameStart"
>) => {
  if (!selectedGuildId) {
    return (
      <Text size="xs" c="dimmed">
        Select a server to ask questions.
      </Text>
    );
  }
  if (!showRename) return null;
  if (renaming) {
    return (
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconCheck size={14} />}
          onClick={onRenameSave}
          loading={renameLoading}
        >
          Save
        </Button>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconX size={14} />}
          onClick={onRenameCancel}
        >
          Cancel
        </Button>
      </Group>
    );
  }
  return (
    <Button
      size="xs"
      variant="subtle"
      leftSection={<IconPencil size={14} />}
      onClick={onRenameStart}
      data-testid="ask-rename"
    >
      Rename
    </Button>
  );
};

const AskConversationActions = ({
  listMode,
  activeConversation,
  shareActionDisabled,
  isArchived,
  archiveLoading,
  canExport,
  showRename,
  renaming,
  selectedGuildId,
  renameLoading,
  onShareOpen,
  onArchiveOpen,
  onExport,
  onRenameSave,
  onRenameCancel,
  onRenameStart,
}: AskConversationActionsProps) => {
  const canEditConversation =
    listMode !== "shared" && Boolean(activeConversation);
  return (
    <Group gap="xs" align="center" wrap="wrap">
      {canEditConversation ? (
        <AskConversationPrimaryActions
          shareActionDisabled={shareActionDisabled}
          isArchived={isArchived}
          archiveLoading={archiveLoading}
          canExport={canExport}
          onShareOpen={onShareOpen}
          onArchiveOpen={onArchiveOpen}
          onExport={onExport}
        />
      ) : null}
      <AskConversationRenameAction
        showRename={showRename}
        renaming={renaming}
        selectedGuildId={selectedGuildId}
        renameLoading={renameLoading}
        onRenameSave={onRenameSave}
        onRenameCancel={onRenameCancel}
        onRenameStart={onRenameStart}
      />
    </Group>
  );
};

export const AskConversationHeader = ({
  listMode,
  activeConversation,
  displayTitle,
  isShared,
  shareDisplayVisibility,
  shareBadgeLabel,
  isArchived,
  shareActionDisabled,
  canExport,
  renaming,
  showRename,
  renameDraft,
  selectedGuildId,
  renameLoading,
  archiveLoading,
  onRenameDraftChange,
  onRenameSave,
  onRenameCancel,
  onRenameStart,
  onShareOpen,
  onArchiveOpen,
  onExport,
}: AskConversationHeaderProps) => (
  <Group justify="space-between" align="center" wrap="wrap">
    <Group gap="sm" align="center" wrap="wrap">
      <ThemeIcon variant="light" color="brand">
        <IconMessage size={16} />
      </ThemeIcon>
      {renaming && showRename ? (
        <AskConversationRenameInput
          renameDraft={renameDraft}
          onRenameDraftChange={onRenameDraftChange}
          onRenameSave={onRenameSave}
          onRenameCancel={onRenameCancel}
        />
      ) : (
        <AskConversationTitle
          displayTitle={displayTitle}
          isShared={isShared}
          shareDisplayVisibility={shareDisplayVisibility}
          shareBadgeLabel={shareBadgeLabel}
          isArchived={isArchived}
        />
      )}
    </Group>
    <AskConversationActions
      listMode={listMode}
      activeConversation={activeConversation}
      shareActionDisabled={shareActionDisabled}
      isArchived={isArchived}
      archiveLoading={archiveLoading}
      canExport={canExport}
      showRename={showRename}
      renaming={renaming}
      selectedGuildId={selectedGuildId}
      renameLoading={renameLoading}
      onShareOpen={onShareOpen}
      onArchiveOpen={onArchiveOpen}
      onExport={onExport}
      onRenameSave={onRenameSave}
      onRenameCancel={onRenameCancel}
      onRenameStart={onRenameStart}
    />
  </Group>
);

export type { AskConversationHeaderProps };
