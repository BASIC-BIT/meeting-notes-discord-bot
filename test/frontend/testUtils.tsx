import React from "react";
import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { authState, resetAuthState } from "./mocks/authState";
import { guildState, resetGuildState } from "./mocks/guildState";
import { resetTrpcMocks } from "./mocks/trpc";
import {
  navigateSpy,
  resetNavigateSpy,
  resetRouterState,
  setRouteParams,
  setRouterPathname,
} from "./mocks/routerState";
import "./mocks/mockFrontendContexts";
import "./mocks/mockRouter";

export const renderWithMantine = (ui: React.ReactElement) =>
  render(<MantineProvider>{ui}</MantineProvider>);

export const resetFrontendMocks = () => {
  resetAuthState();
  resetGuildState();
  resetNavigateSpy();
  resetRouterState();
  resetTrpcMocks();
};

export {
  authState,
  guildState,
  navigateSpy,
  setRouteParams,
  setRouterPathname,
};
