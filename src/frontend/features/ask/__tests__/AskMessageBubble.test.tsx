import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AskMessageBubble } from "../AskMessageBubble";
import type { AskMessage } from "../../../../types/ask";

const baseMessage: AskMessage = {
  id: "m1",
  role: "chronote",
  text: "Here is the summary.",
  createdAt: "2024-01-01T00:00:00Z",
};

describe("AskMessageBubble", () => {
  const renderWithProvider = (ui: React.ReactElement) =>
    render(<MantineProvider>{ui}</MantineProvider>);

  it("shows copy actions for Chronote messages", () => {
    renderWithProvider(
      <AskMessageBubble
        message={baseMessage}
        roleLabels={{ user: "You", chronote: "Chronote" }}
        highlighted={false}
        showActions
      />,
    );

    expect(screen.getByLabelText("Copy message link")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy response")).toBeInTheDocument();
  });

  it("omits response action for user messages", () => {
    renderWithProvider(
      <AskMessageBubble
        message={{ ...baseMessage, role: "user" }}
        roleLabels={{ user: "You", chronote: "Chronote" }}
        highlighted={false}
        showActions
      />,
    );

    expect(screen.getByLabelText("Copy message link")).toBeInTheDocument();
    expect(screen.queryByLabelText("Copy response")).toBeNull();
  });
});
