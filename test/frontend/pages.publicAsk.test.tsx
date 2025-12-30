import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { screen } from "@testing-library/react";
import {
  renderWithMantine,
  resetFrontendMocks,
  setRouteParams,
} from "./testUtils";
import { setAskPublicConversationQuery } from "./mocks/trpc";
import PublicAsk from "../../src/frontend/pages/PublicAsk";

describe("Public Ask page", () => {
  beforeEach(() => {
    resetFrontendMocks();
    setRouteParams({ serverId: "g1", conversationId: "c1" });
  });

  test("renders shared conversation details", () => {
    setAskPublicConversationQuery({
      data: {
        conversation: {
          id: "c1",
          title: "Quarterly planning",
          summary: "Planning recap",
          createdAt: "2025-12-20T12:00:00.000Z",
          updatedAt: "2025-12-20T12:10:00.000Z",
          visibility: "public",
        },
        messages: [
          {
            id: "m1",
            role: "user",
            text: "What did we decide?",
            createdAt: "2025-12-20T12:01:00.000Z",
          },
          {
            id: "m2",
            role: "chronote",
            text: "Ship in January.",
            createdAt: "2025-12-20T12:02:00.000Z",
          },
        ],
        shared: {
          conversationId: "c1",
          title: "Quarterly planning",
          summary: "Planning recap",
          updatedAt: "2025-12-20T12:10:00.000Z",
          sharedAt: "2025-12-20T12:05:00.000Z",
          ownerUserId: "u1",
          ownerTag: "Ada Lovelace",
        },
      },
    });

    renderWithMantine(<PublicAsk />);

    expect(screen.getAllByText("Quarterly planning").length).toBeGreaterThan(0);
    expect(screen.getByText(/Shared by Ada Lovelace/i)).toBeInTheDocument();
    expect(screen.getByText(/Ship in January/i)).toBeInTheDocument();
  });

  test("shows unavailable when conversation is missing", () => {
    setAskPublicConversationQuery({
      data: { conversation: null, messages: [], shared: null },
      error: new Error("Not found"),
    });

    renderWithMantine(<PublicAsk />);

    expect(
      screen.getByText(/This shared thread is unavailable/i),
    ).toBeInTheDocument();
  });
});
