import React from "react";
import { navigateSpy, routeParams, routerState } from "./routerState";

jest.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => (
    <span data-testid="navigate" data-to={to} />
  ),
  Outlet: () => <div data-testid="router-outlet" />,
  useNavigate: () => navigateSpy,
  useParams: () => routeParams,
  useRouterState: (options?: {
    select?: (state: { location: { pathname: string } }) => string;
  }) =>
    options?.select
      ? options.select({ location: { pathname: routerState.pathname } })
      : { location: { pathname: routerState.pathname } },
}));
