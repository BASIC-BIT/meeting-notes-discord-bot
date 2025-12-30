import { router } from "./trpc";
import { askRouter } from "./routers/ask";
import { authRouter } from "./routers/auth";
import { autorecordRouter } from "./routers/autorecord";
import { billingRouter } from "./routers/billing";
import { channelContextsRouter } from "./routers/channelContexts";
import { configRouter } from "./routers/config";
import { contextRouter } from "./routers/context";
import { meetingsRouter } from "./routers/meetings";
import { pricingRouter } from "./routers/pricing";
import { serversRouter } from "./routers/servers";

export const appRouter = router({
  ask: askRouter,
  auth: authRouter,
  autorecord: autorecordRouter,
  billing: billingRouter,
  channelContexts: channelContextsRouter,
  config: configRouter,
  context: contextRouter,
  meetings: meetingsRouter,
  pricing: pricingRouter,
  servers: serversRouter,
});

export type AppRouter = typeof appRouter;
