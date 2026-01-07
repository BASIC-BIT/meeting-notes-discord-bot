import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { AskComposer } from "./AskComposer";

const meta: Meta<typeof AskComposer> = {
  title: "Ask/Composer",
  component: AskComposer,
  render: (args) => {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    return <AskComposer {...args} inputRef={inputRef} />;
  },
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
