import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { guildState } from "./testUtils";
import { setAskConversationQuery, setAskListQuery } from "./mocks/trpc";
import Ask from "../../src/frontend/pages/Ask";

describe("Ask page", () => {
  beforeEach(() => {
    resetFrontendMocks();
  });

  test("prompts to select a server when none is selected", () => {
    guildState.selectedGuildId = null;
    setAskListQuery({ data: { conversations: [] } });
    renderWithMantine(<Ask />);
    expect(
      screen.getByText(/Select a server to ask questions/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ask-input")).toBeDisabled();
  });

  test("renders conversation messages for selected server", async () => {
    guildState.selectedGuildId = "g1";
    setAskListQuery({
      data: {
        conversations: [
          {
            id: "c1",
            title: "Weekly sync",
            summary: "Team updates",
            createdAt: "2025-12-01T00:00:00.000Z",
            updatedAt: "2025-12-02T00:00:00.000Z",
          },
        ],
      },
    });
    setAskConversationQuery({
      data: {
        conversation: {
          id: "c1",
          title: "Weekly sync",
          summary: "Team updates",
          createdAt: "2025-12-01T00:00:00.000Z",
          updatedAt: "2025-12-02T00:00:00.000Z",
        },
        messages: [
          {
            id: "m1",
            role: "user",
            text: "What did we decide?",
            createdAt: "2025-12-02T12:00:00.000Z",
          },
          {
            id: "m2",
            role: "chronote",
            text: "You decided to ship next week.",
            createdAt: "2025-12-02T12:01:00.000Z",
          },
        ],
      },
    });

    renderWithMantine(<Ask />);

    await waitFor(() => {
      expect(screen.getAllByTestId("ask-message").length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId("ask-rename")).toBeInTheDocument();
    expect(screen.getByText(/ship next week/i)).toBeInTheDocument();
  });
});
