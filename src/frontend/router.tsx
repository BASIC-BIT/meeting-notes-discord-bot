import {
  lazyRouteComponent,
  Navigate,
  Outlet,
  RootRoute,
  Route,
  Router,
} from "@tanstack/react-router";
import { z } from "zod";
import MarketingLayout from "./layouts/MarketingLayout";

const PortalLayout = lazyRouteComponent(() => import("./layouts/PortalLayout"));
const PortalServerLayout = lazyRouteComponent(
  () => import("./layouts/PortalServerLayout"),
);
const ServerSelect = lazyRouteComponent(() => import("./pages/ServerSelect"));
const Library = lazyRouteComponent(() => import("./pages/Library"));
const Ask = lazyRouteComponent(() => import("./pages/Ask"));
const PublicAsk = lazyRouteComponent(() => import("./pages/PublicAsk"));
const Billing = lazyRouteComponent(() => import("./pages/Billing"));
const Settings = lazyRouteComponent(() => import("./pages/Settings"));
const LiveMeeting = lazyRouteComponent(() => import("./pages/LiveMeeting"));
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

const liveMeetingRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "live/$guildId/$meetingId",
  component: LiveMeeting,
});

const portalRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "portal",
  component: PortalLayout,
});

function PortalIndexRedirect() {
  const { selectedGuildId, guilds } = useGuildContext();
  const lastServerId = usePortalStore((state) => state.lastServerId);
  const targetServerId = selectedGuildId || lastServerId;
  if (targetServerId) {
    const canManage =
      guilds.find((guild) => guild.id === targetServerId)?.canManage ?? false;
    return (
      <Navigate
        to={
          canManage
            ? "/portal/server/$serverId/library"
            : "/portal/server/$serverId/ask"
        }
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
  validateSearch: z.object({ meetingId: z.string().optional() }).parse,
});

const askSearchSchema = z.object({
  list: z.enum(["mine", "shared"]).optional(),
  messageId: z.string().optional(),
}).parse;

const portalAskRoute = new Route({
  getParentRoute: () => portalServerRoute,
  path: "ask",
  component: Ask,
  validateSearch: askSearchSchema,
});

const portalAskConversationRoute = new Route({
  getParentRoute: () => portalServerRoute,
  path: "ask/$conversationId",
  component: Ask,
  validateSearch: askSearchSchema,
});

const publicAskSearchSchema = z.object({
  messageId: z.string().optional(),
}).parse;

const publicAskRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "share/ask/$serverId/$conversationId",
  component: PublicAsk,
  validateSearch: publicAskSearchSchema,
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
  liveMeetingRoute,
  publicAskRoute,
  portalRoute.addChildren([
    portalIndexRoute,
    portalSelectRoute,
    portalServerRoute.addChildren([
      portalLibraryRoute,
      portalAskRoute,
      portalAskConversationRoute,
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
