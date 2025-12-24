import {
  lazyRouteComponent,
  Navigate,
  Outlet,
  RootRoute,
  Route,
  Router,
} from "@tanstack/react-router";
import MarketingLayout from "./layouts/MarketingLayout";

const PortalLayout = lazyRouteComponent(() => import("./layouts/PortalLayout"));
const PortalServerLayout = lazyRouteComponent(
  () => import("./layouts/PortalServerLayout"),
);
const ServerSelect = lazyRouteComponent(() => import("./pages/ServerSelect"));
const Library = lazyRouteComponent(() => import("./pages/Library"));
const Ask = lazyRouteComponent(() => import("./pages/Ask"));
const Billing = lazyRouteComponent(() => import("./pages/Billing"));
const Settings = lazyRouteComponent(() => import("./pages/Settings"));
import { useGuildContext } from "./contexts/GuildContext";
import { usePortalStore } from "./stores/portalStore";

function RootLayout() {
  return <Outlet />;
}

const rootRoute = new RootRoute({
  component: RootLayout,
});

const homeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: MarketingLayout,
});

const portalRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "portal",
  component: PortalLayout,
});

function PortalIndexRedirect() {
  const { selectedGuildId } = useGuildContext();
  const lastServerId = usePortalStore((state) => state.lastServerId);
  const targetServerId = selectedGuildId || lastServerId;
  if (targetServerId) {
    return (
      <Navigate
        to="/portal/server/$serverId/library"
        params={{ serverId: targetServerId }}
      />
    );
  }
  return <Navigate to="/portal/select-server" />;
}

const portalIndexRoute = new Route({
  getParentRoute: () => portalRoute,
  path: "/",
  component: PortalIndexRedirect,
});

const portalSelectRoute = new Route({
  getParentRoute: () => portalRoute,
  path: "select-server",
  component: ServerSelect,
});

const portalServerRoute = new Route({
  getParentRoute: () => portalRoute,
  path: "server/$serverId",
  component: PortalServerLayout,
});

const portalLibraryRoute = new Route({
  getParentRoute: () => portalServerRoute,
  path: "library",
  component: Library,
});

const portalAskRoute = new Route({
  getParentRoute: () => portalServerRoute,
  path: "ask",
  component: Ask,
});

const portalBillingRoute = new Route({
  getParentRoute: () => portalServerRoute,
  path: "billing",
  component: Billing,
});

const portalSettingsRoute = new Route({
  getParentRoute: () => portalServerRoute,
  path: "settings",
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  portalRoute.addChildren([
    portalIndexRoute,
    portalSelectRoute,
    portalServerRoute.addChildren([
      portalLibraryRoute,
      portalAskRoute,
      portalBillingRoute,
      portalSettingsRoute,
    ]),
  ]),
]);

export const router = new Router({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
