import { z } from "zod";
import {
  clearServerContextService,
  fetchServerContext,
  setServerContext,
} from "../../services/appContextService";
import { ensureBotPresence } from "./ensureBotPresence";
import { manageGuildProcedure, router } from "../trpc";

const get = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    await ensureBotPresence(ctx, input.serverId);
    const ctxRecord = await fetchServerContext(input.serverId);
    return {
      context: ctxRecord?.context ?? "",
      defaultNotesChannelId: ctxRecord?.defaultNotesChannelId ?? null,
      defaultTags: ctxRecord?.defaultTags ?? [],
      liveVoiceEnabled: ctxRecord?.liveVoiceEnabled ?? false,
      liveVoiceTtsVoice: ctxRecord?.liveVoiceTtsVoice ?? null,
      chatTtsEnabled: ctxRecord?.chatTtsEnabled ?? false,
      chatTtsVoice: ctxRecord?.chatTtsVoice ?? null,
    };
  });

const set = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      context: z.string().optional(),
      defaultNotesChannelId: z.string().nullable().optional(),
      defaultTags: z.array(z.string()).optional(),
      liveVoiceEnabled: z.boolean().optional(),
      liveVoiceTtsVoice: z.string().nullable().optional(),
      chatTtsEnabled: z.boolean().optional(),
      chatTtsVoice: z.string().nullable().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
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
      ...(input.liveVoiceTtsVoice !== undefined
        ? { liveVoiceTtsVoice: input.liveVoiceTtsVoice }
        : {}),
      ...(input.chatTtsEnabled !== undefined
        ? { chatTtsEnabled: input.chatTtsEnabled }
        : {}),
      ...(input.chatTtsVoice !== undefined
        ? { chatTtsVoice: input.chatTtsVoice }
        : {}),
    };
    if (Object.keys(update).length === 0) {
      return { ok: true };
    }
    await setServerContext(input.serverId, ctx.user.id, update);
    return { ok: true };
  });

const clear = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await ensureBotPresence(ctx, input.serverId);
    await clearServerContextService(input.serverId);
    return { ok: true };
  });

export const contextRouter = router({
  get,
  set,
  clear,
});
