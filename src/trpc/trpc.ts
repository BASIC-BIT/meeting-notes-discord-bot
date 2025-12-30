import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";
import {
  getPermissionReason,
  requireGuildId,
  requireManageGuild,
  PERMISSION_REASONS,
} from "./permissions";
import { ensureUserInGuild } from "../services/guildAccessService";

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

const isGuildMember = t.middleware(
  async ({ ctx, input, getRawInput, next }) => {
    if (!ctx.user?.accessToken) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const resolvedInput = input ?? (await getRawInput());
    const guildId = requireGuildId(resolvedInput);
    const allowed = await ensureUserInGuild(ctx.user.accessToken, guildId);
    if (allowed === null) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Discord rate limited. Please retry.",
        cause: { reason: PERMISSION_REASONS.discordRateLimited },
      });
    }
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Guild membership required",
        cause: { reason: PERMISSION_REASONS.guildMemberRequired },
      });
    }
    return next();
  },
);

export const router = t.router;
export const publicProcedure = t.procedure;
export const authedProcedure = t.procedure.use(isAuthed);
export const manageGuildProcedure = authedProcedure.use(isManageGuild);
export const guildMemberProcedure = authedProcedure.use(isGuildMember);
