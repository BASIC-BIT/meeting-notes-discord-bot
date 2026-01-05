import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { guildState } from "./testUtils";
import {
  setMeetingsDetailQuery,
  setMeetingsListQuery,
  setServersChannelsQuery,
} from "./mocks/trpc";
import Library from "../../src/frontend/pages/Library";

describe("Library page", () => {
  beforeEach(() => {
    resetFrontendMocks();
    guildState.selectedGuildId = "g1";
    guildState.guilds = [{ id: "g1", name: "Guild One", canManage: true }];
    setServersChannelsQuery({
      data: {
        voiceChannels: [{ id: "c1", name: "General", botAccess: true }],
        textChannels: [{ id: "t1", name: "notes", botAccess: true }],
      },
    });
  });

  test("shows empty state when no meetings match filters", () => {
    setMeetingsListQuery({
      data: { meetings: [] },
      isLoading: false,
      error: null,
    });
    renderWithMantine(<Library />);
    expect(screen.getByTestId("library-refresh-top")).toBeInTheDocument();
    expect(
      screen.getByText(/No meetings match these filters yet/i),
    ).toBeInTheDocument();
  });

  test("renders meeting details for a selected row", async () => {
    const meetingTimestamp = "2025-12-20T12:00:00.000Z";
    setMeetingsListQuery({
      data: {
        meetings: [
          {
            id: "row-1",
            meetingId: "m1",
            channelId: "c1",
            channelName: "General",
            timestamp: meetingTimestamp,
            duration: 3600,
            tags: ["alpha"],
            notes: "Summary: Weekly sync",
            summarySentence: "Weekly sync summary",
            summaryLabel: "Highlights",
            audioAvailable: false,
            transcriptAvailable: true,
          },
        ],
      },
    });
    setMeetingsDetailQuery({
      data: {
        meeting: {
          id: "detail-1",
          meetingId: "m1",
          channelId: "c1",
          timestamp: meetingTimestamp,
          duration: 3600,
          tags: ["alpha"],
          notes: "Summary: Weekly sync",
          summarySentence: null,
          summaryLabel: null,
          audioUrl: null,
          attendees: [],
          events: [],
        },
      },
    });
    renderWithMantine(<Library />);

    fireEvent.click(screen.getByTestId("library-meeting-row"));

    await waitFor(() => {
      expect(screen.getByText(/Audio isn/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Full transcript/i)).toBeInTheDocument();
  });
});
