import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  clearServerContextService,
  fetchServerContext,
  setServerContext,
} from "../../services/appContextService";
import { ensureManageGuildWithUserToken } from "../../services/guildAccessService";
import { ensureBotPresence } from "./ensureBotPresence";
import { authedProcedure, router } from "../trpc";

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
    return {
      context: ctxRecord?.context ?? "",
      defaultNotesChannelId: ctxRecord?.defaultNotesChannelId ?? null,
      defaultTags: ctxRecord?.defaultTags ?? [],
      liveVoiceEnabled: ctxRecord?.liveVoiceEnabled ?? false,
    };
  });

const set = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      context: z.string().optional(),
      defaultNotesChannelId: z.string().nullable().optional(),
      defaultTags: z.array(z.string()).optional(),
      liveVoiceEnabled: z.boolean().optional(),
    }),
  )
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
    const update = {
      ...(input.context !== undefined ? { context: input.context } : {}),
      ...(input.defaultNotesChannelId !== undefined
        ? { defaultNotesChannelId: input.defaultNotesChannelId }
        : {}),
      ...(input.defaultTags !== undefined
        ? { defaultTags: input.defaultTags }
        : {}),
      ...(input.liveVoiceEnabled !== undefined
        ? { liveVoiceEnabled: input.liveVoiceEnabled }
        : {}),
    };
    if (Object.keys(update).length === 0) {
      return { ok: true };
    }
    await setServerContext(input.serverId, ctx.user.id, update);
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
