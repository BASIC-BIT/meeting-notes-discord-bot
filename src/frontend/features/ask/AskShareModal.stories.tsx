import type { Meta, StoryObj } from "@storybook/react";
import { AskShareModal } from "./AskShareModal";
import type { AskConversation } from "../../../types/ask";

const baseConversation: AskConversation = {
  id: "c1",
  title: "Q1 roadmap",
  summary: "Roadmap recap and open questions.",
  createdAt: "2026-01-02T15:10:00.000Z",
  updatedAt: "2026-01-02T16:00:00.000Z",
};

const meta: Meta<typeof AskShareModal> = {
  title: "Ask/ShareModal",
  component: AskShareModal,
  args: {
    opened: true,
    onClose: () => undefined,
    publicSharingEnabled: true,
    sharingEnabled: true,
    activeConversation: baseConversation,
    isShared: true,
    shareDisplayVisibility: "public",
    shareUrl: "https://chronote.gg/share/ask/demo",
    activeVisibility: "public",
    shareError: null,
    onCopyShareLink: () => undefined,
    onShareChange: () => undefined,
    sharePending: false,
  },
};

export default meta;

type Story = StoryObj<typeof AskShareModal>;

export const PublicShared: Story = {};

export const ServerShared: Story = {
  args: {
    shareDisplayVisibility: "server",
    activeVisibility: "server",
  },
};

export const NotShared: Story = {
  args: {
    isShared: false,
    shareDisplayVisibility: "server",
    activeVisibility: "private",
  },
};

export const SharingDisabled: Story = {
  args: {
    sharingEnabled: false,
    publicSharingEnabled: false,
    isShared: false,
    activeConversation: baseConversation,
  },
};
