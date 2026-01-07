import { createRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { AskComposer } from "./AskComposer";

const inputRef = createRef<HTMLTextAreaElement>();

const meta: Meta<typeof AskComposer> = {
  title: "Ask/Composer",
  component: AskComposer,
  args: {
    listMode: "mine",
    isArchived: false,
    askAccessAllowed: true,
    selectedGuildId: "server-1",
    draft: "What did we decide last week?",
    onDraftChange: () => undefined,
    onAsk: () => undefined,
    askPending: false,
    errorMessage: null,
    inputRef,
  },
};

export default meta;

type Story = StoryObj<typeof AskComposer>;

export const Default: Story = {};

export const ReadOnly: Story = {
  args: {
    listMode: "shared",
    draft: "",
  },
};

export const ErrorState: Story = {
  args: {
    errorMessage: "Unable to reach Chronote.",
  },
};
