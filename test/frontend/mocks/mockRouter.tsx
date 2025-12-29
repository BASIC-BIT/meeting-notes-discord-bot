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
    | ((prev: { meetingId?: string }) => { meetingId?: string })
    | { meetingId?: string };
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
    select?: (state: { location: { pathname: string } }) => string;
  }) =>
    options?.select
      ? options.select({ location: { pathname: routerState.pathname } })
      : { location: { pathname: routerState.pathname } },
}));
