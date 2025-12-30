import { jest } from "@jest/globals";

type Listener = () => void;
const searchListeners = new Set<Listener>();

export const navigateSpy = jest.fn();
export const routerState = {
  pathname: "/",
};
export const routeParams: { serverId?: string; conversationId?: string } = {};
let routeSearch: { meetingId?: string; list?: string; messageId?: string } = {};

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
  routeParams.conversationId = undefined;
  routeSearch = {};
  notifyRouteSearch();
};

export const setRouterPathname = (pathname: string) => {
  routerState.pathname = pathname;
};

export const setRouteParams = (params: {
  serverId?: string;
  conversationId?: string;
}) => {
  routeParams.serverId = params.serverId;
  routeParams.conversationId = params.conversationId;
};

export const setRouteSearch = (search: {
  meetingId?: string;
  list?: string;
  messageId?: string;
}) => {
  routeSearch = { ...routeSearch, ...search };
  notifyRouteSearch();
};
