import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";
import {
  getPermissionReason,
  requireGuildId,
  requireManageGuild,
} from "./permissions";

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const reason = getPermissionReason(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        reason,
      },
    };
  },
});

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.accessToken) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

const isManageGuild = t.middleware(
  async ({ ctx, input, getRawInput, next }) => {
    if (!ctx.user?.accessToken) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const resolvedInput = input ?? (await getRawInput());
    const guildId = requireGuildId(resolvedInput);
    await requireManageGuild({ accessToken: ctx.user.accessToken, guildId });
    return next();
  },
);

export const router = t.router;
export const publicProcedure = t.procedure;
export const authedProcedure = t.procedure.use(isAuthed);
export const manageGuildProcedure = authedProcedure.use(isManageGuild);
