import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { guildState } from "./testUtils";
import {
  setAutorecordListQuery,
  setChannelContextsQuery,
  setContextQuery,
  setServersChannelsQuery,
} from "./mocks/trpc";
import Settings from "../../src/frontend/pages/Settings";

describe("Settings page", () => {
  beforeEach(() => {
    resetFrontendMocks();
    guildState.selectedGuildId = "g1";
    guildState.loading = false;
    setServersChannelsQuery({
      data: {
        voiceChannels: [],
        textChannels: [],
      },
    });
    setAutorecordListQuery({
      data: {
        rules: [
          {
            guildId: "g1",
            channelId: "ALL",
            enabled: true,
            recordAll: true,
            createdBy: "u1",
            createdAt: "2025-12-01T00:00:00.000Z",
          },
        ],
      },
    });
    setContextQuery({
      data: {
        context: "",
        defaultTags: [],
        defaultNotesChannelId: null,
        liveVoiceEnabled: false,
        chatTtsEnabled: false,
      },
    });
    setChannelContextsQuery({ data: { contexts: [] } });
  });

  test("shows record-all warning when default notes channel is missing", async () => {
    renderWithMantine(<Settings />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Recording all channels uses the default notes channel/i,
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        /Default notes channel is required when record all is enabled/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-add-channel")).toBeDisabled();
  });
});
