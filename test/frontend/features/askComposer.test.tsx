import { createRef } from "react";
import { describe, expect, test, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react";
import { AskComposer } from "../../../src/frontend/features/ask/AskComposer";
import { renderWithMantine } from "../testUtils";

const buildProps = () => ({
  listMode: "mine" as const,
  isArchived: false,
  askAccessAllowed: true,
  selectedGuildId: "server-1",
  draft: "What did we decide?",
  onDraftChange: () => undefined,
  onAsk: () => undefined,
  askPending: false,
  errorMessage: null,
  inputRef: createRef<HTMLTextAreaElement>(),
});

describe("AskComposer", () => {
  test("renders shared mode as read only", () => {
    const props = buildProps();
    renderWithMantine(
      <AskComposer
        {...props}
        listMode="shared"
        draft=""
        selectedGuildId="server-1"
      />,
    );

    expect(
      screen.getByPlaceholderText(/Shared threads are read only/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ask-input")).toBeDisabled();
    expect(screen.getByTestId("ask-send")).toBeDisabled();
  });

  test("enables ask button when input is valid", () => {
    const props = buildProps();
    renderWithMantine(<AskComposer {...props} />);

    expect(screen.getByTestId("ask-send")).toBeEnabled();
  });

  test("submits on ctrl+enter", () => {
    const onAsk = jest.fn();
    const props = buildProps();
    renderWithMantine(<AskComposer {...props} onAsk={onAsk} />);

    fireEvent.keyDown(screen.getByTestId("ask-input"), {
      key: "Enter",
      ctrlKey: true,
    });

    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
