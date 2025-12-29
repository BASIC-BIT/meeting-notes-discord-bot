import { jest } from "@jest/globals";

export const navigateSpy = jest.fn();

export const routerState = {
  pathname: "/",
};

export const routeParams: { serverId?: string } = {};

export const resetNavigateSpy = () => {
  navigateSpy.mockClear();
};

export const resetRouterState = () => {
  routerState.pathname = "/";
  routeParams.serverId = undefined;
};

export const setRouterPathname = (pathname: string) => {
  routerState.pathname = pathname;
};

export const setRouteParams = (params: { serverId?: string }) => {
  routeParams.serverId = params.serverId;
};
