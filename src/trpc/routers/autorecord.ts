import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  listAutoRecordSettings,
  removeAutoRecordSetting,
  saveAutoRecordSetting,
} from "../../services/autorecordService";
import { ensureManageGuildWithUserToken } from "../../services/guildAccessService";
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
    const rules = await listAutoRecordSettings(input.serverId);
    return { rules };
  });

const add = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      mode: z.enum(["one", "all"]),
      voiceChannelId: z.string().optional(),
      textChannelId: z.string(),
      tags: z.array(z.string()).optional(),
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
    if (input.mode === "one" && !input.voiceChannelId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "voiceChannelId required for mode=one",
      });
    }
    const rule = await saveAutoRecordSetting({
      guildId: input.serverId,
      channelId: input.mode === "all" ? "ALL" : input.voiceChannelId!,
      textChannelId: input.textChannelId,
      enabled: true,
      recordAll: input.mode === "all",
      createdBy: ctx.user.id,
      tags: input.tags,
    });
    return { rule };
  });

const remove = authedProcedure
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
    await removeAutoRecordSetting(input.serverId, input.channelId);
    return { ok: true };
  });

export const autorecordRouter = router({
  list,
  add,
  remove,
});
