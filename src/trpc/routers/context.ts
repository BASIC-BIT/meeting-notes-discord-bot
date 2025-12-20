import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  clearServerContextService,
  fetchServerContext,
  setServerContext,
} from "../../services/appContextService";
import {
  ensureBotInGuild,
  ensureManageGuildWithUserToken,
} from "../../services/guildAccessService";
import type { TrpcContext } from "../context";
import { authedProcedure, router } from "../trpc";

const ensureBotPresence = async (ctx: TrpcContext, serverId: string) => {
  const sessionData = ctx.req.session as typeof ctx.req.session & {
    botGuildIds?: string[];
    botGuildIdsFetchedAt?: number;
  };
  const cacheAgeMs =
    sessionData.botGuildIdsFetchedAt != null
      ? Date.now() - sessionData.botGuildIdsFetchedAt
      : Number.POSITIVE_INFINITY;
  const cacheFresh = cacheAgeMs < 5 * 60 * 1000;
  if (cacheFresh && sessionData.botGuildIds) {
    if (!sessionData.botGuildIds.includes(serverId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bot is not in that guild",
      });
    }
    return;
  }
  const botCheck = await ensureBotInGuild(serverId);
  if (botCheck === null) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Discord rate limited. Please retry.",
    });
  }
  if (!botCheck) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Bot is not in that guild",
    });
  }
  sessionData.botGuildIds = Array.from(
    new Set([...(sessionData.botGuildIds ?? []), serverId]),
  );
  sessionData.botGuildIdsFetchedAt = Date.now();
};

const get = authedProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
    await ensureBotPresence(ctx, input.serverId);
    const ctxRecord = await fetchServerContext(input.serverId);
    return { context: ctxRecord?.context ?? "" };
  });

const set = authedProcedure
  .input(z.object({ serverId: z.string(), context: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
    await ensureBotPresence(ctx, input.serverId);
    await setServerContext(input.serverId, ctx.user.id, input.context);
    return { ok: true };
  });

const clear = authedProcedure
  .input(z.object({ serverId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
    await ensureBotPresence(ctx, input.serverId);
    await clearServerContextService(input.serverId);
    return { ok: true };
  });

export const contextRouter = router({
  get,
  set,
  clear,
});
