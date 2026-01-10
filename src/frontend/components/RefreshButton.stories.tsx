import type { Meta, StoryObj } from "@storybook/react";
import { RefreshButton } from "./RefreshButton";

const meta: Meta<typeof RefreshButton> = {
  title: "Components/RefreshButton",
  component: RefreshButton,
  args: {
    label: "Refresh",
  },
};

export default meta;

type Story = StoryObj<typeof RefreshButton>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    loading: true,
  },
};
