import { Button, Group, Text } from "@mantine/core";
import type {
  AskConversation,
  AskSharedConversation,
} from "../../../types/ask";
import type { ListMode } from "../../utils/askLinks";
import Surface from "../../components/Surface";

type AskConversationNoticesProps = {
  listMode: ListMode;
  sharedMeta: AskSharedConversation | null;
  isShared: boolean;
  sharingEnabled: boolean;
  renameError: string | null;
  archiveError: string | null;
  activeConversation: AskConversation | null;
  isArchived: boolean;
  onNewConversation: () => void;
};

type AskConversationSharedNoticeProps = {
  listMode: ListMode;
  sharedMeta: AskSharedConversation | null;
};

type AskConversationSharingDisabledProps = {
  listMode: ListMode;
  isShared: boolean;
  sharingEnabled: boolean;
};

type AskConversationErrorProps = {
  message: string | null;
};

type AskConversationSharedBannerProps = {
  listMode: ListMode;
  activeConversation: AskConversation | null;
  onNewConversation: () => void;
};

type AskConversationArchivedBannerProps = {
  isArchived: boolean;
  listMode: ListMode;
};

const AskConversationSharedNotice = ({
  listMode,
  sharedMeta,
}: AskConversationSharedNoticeProps) => {
  if (listMode !== "shared" || !sharedMeta?.ownerTag) return null;
  return (
    <Text size="xs" c="dimmed">
      Shared by {sharedMeta.ownerTag}
    </Text>
  );
};

const AskConversationSharingDisabled = ({
  listMode,
  isShared,
  sharingEnabled,
}: AskConversationSharingDisabledProps) => {
  if (listMode !== "mine" || !isShared || sharingEnabled) return null;
  return (
    <Text size="xs" c="dimmed">
      Sharing is disabled by server settings.
    </Text>
  );
};

const AskConversationErrorText = ({ message }: AskConversationErrorProps) =>
  message ? (
    <Text size="xs" c="red">
      {message}
    </Text>
  ) : null;

const AskConversationSharedBanner = ({
  listMode,
  activeConversation,
  onNewConversation,
}: AskConversationSharedBannerProps) => {
  if (listMode !== "shared" || !activeConversation) return null;
  return (
    <Surface p="sm" tone="soft">
      <Group justify="space-between" align="center" wrap="wrap">
        <Text size="sm" c="dimmed">
          Shared threads are read only. Start a new chat to keep exploring.
        </Text>
        <Button size="xs" variant="light" onClick={onNewConversation}>
          Start new chat
        </Button>
      </Group>
    </Surface>
  );
};

const AskConversationArchivedBanner = ({
  isArchived,
  listMode,
}: AskConversationArchivedBannerProps) => {
  if (!isArchived) return null;
  return (
    <Surface p="sm" tone="soft">
      <Text size="sm" c="dimmed">
        {listMode === "shared"
          ? "This thread was archived by its owner and is read only."
          : "Archived chats are read only. Unarchive to continue."}
      </Text>
    </Surface>
  );
};

export const AskConversationNotices = ({
  listMode,
  sharedMeta,
  isShared,
  sharingEnabled,
  renameError,
  archiveError,
  activeConversation,
  isArchived,
  onNewConversation,
}: AskConversationNoticesProps) => (
  <>
    <AskConversationSharedNotice listMode={listMode} sharedMeta={sharedMeta} />
    <AskConversationSharingDisabled
      listMode={listMode}
      isShared={isShared}
      sharingEnabled={sharingEnabled}
    />
    <AskConversationErrorText message={renameError} />
    <AskConversationErrorText message={archiveError} />
    <AskConversationSharedBanner
      listMode={listMode}
      activeConversation={activeConversation}
      onNewConversation={onNewConversation}
    />
    <AskConversationArchivedBanner
      isArchived={isArchived}
      listMode={listMode}
    />
  </>
);

export type { AskConversationNoticesProps };
