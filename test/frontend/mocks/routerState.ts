import { jest } from "@jest/globals";

type Listener = () => void;
const searchListeners = new Set<Listener>();

export const navigateSpy = jest.fn();
export const routerState = {
  pathname: "/",
};
export const routeParams: { serverId?: string } = {};
let routeSearch: { meetingId?: string } = {};

export const getRouteSearch = () => routeSearch;

export const subscribeRouteSearch = (listener: Listener) => {
  searchListeners.add(listener);
  return () => {
    searchListeners.delete(listener);
  };
};

export const notifyRouteSearch = () => {
  searchListeners.forEach((listener) => listener());
};

export const resetNavigateSpy = () => {
  navigateSpy.mockClear();
};

export const resetRouterState = () => {
  routerState.pathname = "/";
  routeParams.serverId = undefined;
  routeSearch = {};
  notifyRouteSearch();
};

export const setRouterPathname = (pathname: string) => {
  routerState.pathname = pathname;
};

export const setRouteParams = (params: { serverId?: string }) => {
  routeParams.serverId = params.serverId;
};

export const setRouteSearch = (search: { meetingId?: string }) => {
  routeSearch = { ...routeSearch, ...search };
  notifyRouteSearch();
};
