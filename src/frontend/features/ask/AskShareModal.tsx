import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import type {
  AskConversation,
  AskConversationVisibility,
} from "../../../types/ask";

type AskShareModalProps = {
  opened: boolean;
  onClose: () => void;
  publicSharingEnabled: boolean;
  sharingEnabled: boolean;
  activeConversation: AskConversation | null;
  isShared: boolean;
  shareDisplayVisibility: AskConversationVisibility;
  shareUrl: string;
  activeVisibility: AskConversationVisibility;
  shareError: string | null;
  onCopyShareLink: () => void;
  onShareChange: (visibility: AskConversationVisibility) => void;
  sharePending: boolean;
};

type ShareVisibilityToggle = {
  label: string;
  next: AskConversationVisibility;
};

const resolveVisibilityToggle = (
  publicSharingEnabled: boolean,
  activeVisibility: AskConversationVisibility,
): ShareVisibilityToggle | null => {
  if (!publicSharingEnabled) return null;
  if (activeVisibility === "public") {
    return { label: "Make server-only", next: "server" };
  }
  if (activeVisibility === "server") {
    return { label: "Make public", next: "public" };
  }
  return null;
};

const AskShareModalIntro = ({
  publicSharingEnabled,
}: Pick<AskShareModalProps, "publicSharingEnabled">) => (
  <Text size="sm" c="dimmed">
    {publicSharingEnabled
      ? "Sharing can be limited to the server or made public. Your Discord username will be shown."
      : "Sharing makes this thread visible to members of this server. Your Discord username will be shown."}
  </Text>
);

const AskShareModalDisabledNotice = ({
  sharingEnabled,
}: Pick<AskShareModalProps, "sharingEnabled">) =>
  sharingEnabled ? null : (
    <Text size="sm" c="dimmed">
      Sharing is disabled for this server.
    </Text>
  );

const AskShareModalSharedActions = ({
  publicSharingEnabled,
  shareDisplayVisibility,
  shareUrl,
  activeVisibility,
  onCopyShareLink,
  onShareChange,
  sharePending,
}: Pick<
  AskShareModalProps,
  | "publicSharingEnabled"
  | "shareDisplayVisibility"
  | "shareUrl"
  | "activeVisibility"
  | "onCopyShareLink"
  | "onShareChange"
  | "sharePending"
>) => {
  const toggle = resolveVisibilityToggle(
    publicSharingEnabled,
    activeVisibility,
  );
  return (
    <>
      <TextInput
        label={
          shareDisplayVisibility === "public" ? "Public link" : "Shared link"
        }
        value={shareUrl}
        readOnly
        rightSection={
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onCopyShareLink}
            aria-label="Copy share link"
          >
            <IconLink size={16} />
          </ActionIcon>
        }
      />
      <Group justify="space-between" align="center" wrap="wrap">
        <Button
          variant="light"
          color="red"
          onClick={() => onShareChange("private")}
          loading={sharePending}
        >
          Turn off sharing
        </Button>
        <Group gap="xs">
          {toggle ? (
            <Button
              variant="subtle"
              onClick={() => onShareChange(toggle.next)}
              loading={sharePending}
            >
              {toggle.label}
            </Button>
          ) : null}
          <Button
            variant="subtle"
            leftSection={<IconLink size={14} />}
            onClick={onCopyShareLink}
          >
            Copy link
          </Button>
        </Group>
      </Group>
    </>
  );
};

const AskShareModalUnsharedActions = ({
  publicSharingEnabled,
  onShareChange,
  sharePending,
}: Pick<
  AskShareModalProps,
  "publicSharingEnabled" | "onShareChange" | "sharePending"
>) => (
  <Group gap="xs">
    <Button onClick={() => onShareChange("server")} loading={sharePending}>
      Share with server
    </Button>
    {publicSharingEnabled ? (
      <Button
        variant="light"
        onClick={() => onShareChange("public")}
        loading={sharePending}
      >
        Share publicly
      </Button>
    ) : null}
  </Group>
);

const AskShareModalBody = ({
  sharingEnabled,
  activeConversation,
  isShared,
  publicSharingEnabled,
  shareDisplayVisibility,
  shareUrl,
  activeVisibility,
  onCopyShareLink,
  onShareChange,
  sharePending,
}: Pick<
  AskShareModalProps,
  | "sharingEnabled"
  | "activeConversation"
  | "isShared"
  | "publicSharingEnabled"
  | "shareDisplayVisibility"
  | "shareUrl"
  | "activeVisibility"
  | "onCopyShareLink"
  | "onShareChange"
  | "sharePending"
>) => {
  if (!sharingEnabled || !activeConversation) return null;
  return isShared ? (
    <AskShareModalSharedActions
      publicSharingEnabled={publicSharingEnabled}
      shareDisplayVisibility={shareDisplayVisibility}
      shareUrl={shareUrl}
      activeVisibility={activeVisibility}
      onCopyShareLink={onCopyShareLink}
      onShareChange={onShareChange}
      sharePending={sharePending}
    />
  ) : (
    <AskShareModalUnsharedActions
      publicSharingEnabled={publicSharingEnabled}
      onShareChange={onShareChange}
      sharePending={sharePending}
    />
  );
};

export function AskShareModal({
  opened,
  onClose,
  publicSharingEnabled,
  sharingEnabled,
  activeConversation,
  isShared,
  shareDisplayVisibility,
  shareUrl,
  activeVisibility,
  shareError,
  onCopyShareLink,
  onShareChange,
  sharePending,
}: AskShareModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Share thread" centered>
      <Stack gap="sm">
        <AskShareModalIntro publicSharingEnabled={publicSharingEnabled} />
        <AskShareModalDisabledNotice sharingEnabled={sharingEnabled} />
        <AskShareModalBody
          sharingEnabled={sharingEnabled}
          activeConversation={activeConversation}
          isShared={isShared}
          publicSharingEnabled={publicSharingEnabled}
          shareDisplayVisibility={shareDisplayVisibility}
          shareUrl={shareUrl}
          activeVisibility={activeVisibility}
          onCopyShareLink={onCopyShareLink}
          onShareChange={onShareChange}
          sharePending={sharePending}
        />
        {shareError ? (
          <Text size="xs" c="red">
            {shareError}
          </Text>
        ) : null}
      </Stack>
    </Modal>
  );
}

export type { AskShareModalProps };
