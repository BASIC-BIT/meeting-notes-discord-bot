import { router } from "./trpc";
import { askRouter } from "./routers/ask";
import { authRouter } from "./routers/auth";
import { autorecordRouter } from "./routers/autorecord";
import { billingRouter } from "./routers/billing";
import { channelContextsRouter } from "./routers/channelContexts";
import { contextRouter } from "./routers/context";
import { meetingsRouter } from "./routers/meetings";
import { serversRouter } from "./routers/servers";

export const appRouter = router({
  ask: askRouter,
  auth: authRouter,
  autorecord: autorecordRouter,
  billing: billingRouter,
  channelContexts: channelContextsRouter,
  context: contextRouter,
  meetings: meetingsRouter,
  servers: serversRouter,
});

export type AppRouter = typeof appRouter;
