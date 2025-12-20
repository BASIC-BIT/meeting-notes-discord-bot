import { router } from "./trpc";
import { askRouter } from "./routers/ask";
import { authRouter } from "./routers/auth";
import { autorecordRouter } from "./routers/autorecord";
import { billingRouter } from "./routers/billing";
import { contextRouter } from "./routers/context";
import { serversRouter } from "./routers/servers";

export const appRouter = router({
  ask: askRouter,
  auth: authRouter,
  autorecord: autorecordRouter,
  billing: billingRouter,
  context: contextRouter,
  servers: serversRouter,
});

export type AppRouter = typeof appRouter;
