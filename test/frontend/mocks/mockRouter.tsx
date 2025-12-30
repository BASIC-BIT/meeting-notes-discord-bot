import React from "react";
import {
  getRouteSearch,
  navigateSpy,
  routeParams,
  routerState,
  setRouteSearch,
  subscribeRouteSearch,
} from "./routerState";

type NavigateOptions = {
  search?:
    | ((prev: { meetingId?: string; list?: string; messageId?: string }) => {
        meetingId?: string;
        list?: string;
        messageId?: string;
      })
    | { meetingId?: string; list?: string; messageId?: string };
};

const buildSearchString = () => {
  const params = new URLSearchParams();
  Object.entries(getRouteSearch()).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
};

const navigate = (options?: NavigateOptions) => {
  navigateSpy(options);
  if (!options || options.search === undefined) {
    return;
  }
  const prev = getRouteSearch();
  const nextSearch =
    typeof options.search === "function"
      ? options.search({ ...prev })
      : options.search;
  setRouteSearch(nextSearch ?? {});
};

jest.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => (
    <span data-testid="navigate" data-to={to} />
  ),
  Outlet: () => <div data-testid="router-outlet" />,
  useNavigate: () => navigate,
  useParams: () => routeParams,
  useSearch: () =>
    React.useSyncExternalStore(
      subscribeRouteSearch,
      getRouteSearch,
      getRouteSearch,
    ),
  useRouterState: (options?: {
    select?: (state: {
      location: { pathname: string; search: string };
    }) => string;
  }) =>
    options?.select
      ? options.select({
          location: {
            pathname: routerState.pathname,
            search: buildSearchString(),
          },
        })
      : {
          location: {
            pathname: routerState.pathname,
            search: buildSearchString(),
          },
        },
}));
