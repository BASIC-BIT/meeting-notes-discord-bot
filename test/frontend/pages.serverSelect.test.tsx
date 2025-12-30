import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { guildState, navigateSpy } from "./testUtils";
import { usePortalStore } from "../../src/frontend/stores/portalStore";
import ServerSelect from "../../src/frontend/pages/ServerSelect";

describe("ServerSelect page", () => {
  beforeEach(() => {
    resetFrontendMocks();
    usePortalStore.setState({ lastServerId: null });
    window.localStorage.clear();
  });

  test("shows loading state", () => {
    guildState.loading = true;
    renderWithMantine(<ServerSelect />);
    expect(screen.getByText(/Loading your servers/i)).toBeInTheDocument();
  });

  test("shows empty state when no guilds are available", () => {
    guildState.loading = false;
    guildState.guilds = [];
    renderWithMantine(<ServerSelect />);
    expect(screen.getByText(/No servers found/i)).toBeInTheDocument();
  });

  test("selects a server and navigates to library", () => {
    guildState.loading = false;
    guildState.guilds = [{ id: "g1", name: "Guild One", canManage: true }];
    renderWithMantine(<ServerSelect />);

    fireEvent.click(screen.getByTestId("server-open"));

    expect(guildState.setSelectedGuildId).toHaveBeenCalledWith("g1");
    expect(usePortalStore.getState().lastServerId).toBe("g1");
    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/portal/server/$serverId/library",
      params: { serverId: "g1" },
    });
  });

  test("navigates non-managers to Ask", () => {
    guildState.loading = false;
    guildState.guilds = [{ id: "g2", name: "Guild Two", canManage: false }];
    renderWithMantine(<ServerSelect />);

    fireEvent.click(screen.getByTestId("server-open"));

    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/portal/server/$serverId/ask",
      params: { serverId: "g2" },
    });
  });
});
