import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  clearChannelContext,
  listChannelContexts,
  setChannelContext,
} from "../../services/channelContextService";
import { ensureManageGuildWithUserToken } from "../../services/guildAccessService";
import { ensureBotPresence } from "./ensureBotPresence";
import { authedProcedure, router } from "../trpc";

const list = authedProcedure
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
    const contexts = await listChannelContexts(input.serverId);
    return { contexts };
  });

const set = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      channelId: z.string(),
      context: z.string().optional(),
      liveVoiceEnabled: z.boolean().optional().nullable(),
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
    const trimmedContext = input.context?.trim();
    await setChannelContext(input.serverId, input.channelId, ctx.user.id, {
      context: trimmedContext ? trimmedContext : null,
      liveVoiceEnabled:
        input.liveVoiceEnabled === undefined
          ? undefined
          : input.liveVoiceEnabled,
    });
    return { ok: true };
  });

const clear = authedProcedure
  .input(z.object({ serverId: z.string(), channelId: z.string() }))
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
    await clearChannelContext(input.serverId, input.channelId);
    return { ok: true };
  });

export const channelContextsRouter = router({
  list,
  set,
  clear,
});
