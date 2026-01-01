import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { guildState } from "./testUtils";
import {
  setAutorecordListQuery,
  setChannelContextsQuery,
  setConfigServerQuery,
  setServersChannelsQuery,
} from "./mocks/trpc";
import Settings from "../../src/frontend/pages/Settings";
import { CONFIG_KEYS } from "../../src/config/keys";

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
    setConfigServerQuery({
      data: {
        registry: [
          {
            key: CONFIG_KEYS.autorecord.enabled,
            label: "Auto-record",
            description: "Automatically record meetings by default.",
            category: "Auto-record",
            valueType: "boolean",
            defaultValue: false,
            scopes: {
              server: {
                enabled: true,
                required: true,
                role: "admin",
                control: "toggle",
              },
            },
            ui: { type: "toggle" },
          },
          {
            key: CONFIG_KEYS.notes.channelId,
            label: "Notes channel",
            description:
              "Default notes channel for meetings and auto-recording.",
            category: "Notes",
            valueType: "string",
            scopes: {
              server: {
                enabled: true,
                required: false,
                role: "admin",
                control: "text",
              },
            },
            ui: { type: "custom", renderer: "NotesChannelSelect" },
          },
          {
            key: CONFIG_KEYS.ask.sharingPolicy,
            label: "Ask sharing policy",
            description: "Default sharing policy for Ask conversations.",
            category: "Ask",
            valueType: "select",
            defaultValue: "server",
            scopes: {
              server: {
                enabled: true,
                required: false,
                role: "admin",
                control: "select",
              },
            },
            ui: { type: "segmented", options: ["off", "server", "public"] },
          },
        ],
        snapshot: {
          values: {
            [CONFIG_KEYS.autorecord.enabled]: {
              value: true,
              source: "server",
            },
            [CONFIG_KEYS.notes.channelId]: { value: "", source: "server" },
            [CONFIG_KEYS.ask.sharingPolicy]: {
              value: "server",
              source: "server",
            },
          },
          experimentalEnabled: false,
          tier: "free",
          missingRequired: [],
        },
        overrides: [],
      },
    });
    setChannelContextsQuery({ data: { contexts: [] } });
  });

  test("shows record-all warning when default notes channel is missing", async () => {
    renderWithMantine(<Settings />);

    await waitFor(() => {
      expect(
        screen.getByText(/Record-all requires a default notes channel/i),
      ).toBeInTheDocument();
    });
    const saveButtons = screen.getAllByRole("button", {
      name: /save settings/i,
    });
    saveButtons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  test("shows public sharing policy option and helper copy", async () => {
    renderWithMantine(<Settings />);

    await waitFor(() => {
      expect(screen.getByText(/Ask sharing policy/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Public")).toBeInTheDocument();
  });
});
