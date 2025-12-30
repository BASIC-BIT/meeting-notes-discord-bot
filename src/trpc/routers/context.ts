import { z } from "zod";
import {
  clearServerContextService,
  fetchServerContext,
  setServerContext,
  type ServerContextUpdate,
} from "../../services/appContextService";
import { ensureBotPresence } from "./ensureBotPresence";
import { manageGuildProcedure, router } from "../trpc";

type ServerContextSnapshot = {
  context?: string;
  defaultNotesChannelId?: string | null;
  defaultTags?: string[];
  liveVoiceEnabled?: boolean;
  liveVoiceCommandsEnabled?: boolean;
  liveVoiceTtsVoice?: string | null;
  chatTtsEnabled?: boolean;
  chatTtsVoice?: string | null;
  askMembersEnabled?: boolean;
  askSharingPolicy?: "off" | "server" | "public";
};

type ServerContextUpdateInput = {
  context?: string;
  defaultNotesChannelId?: string | null;
  defaultTags?: string[];
  liveVoiceEnabled?: boolean;
  liveVoiceCommandsEnabled?: boolean;
  liveVoiceTtsVoice?: string | null;
  chatTtsEnabled?: boolean;
  chatTtsVoice?: string | null;
  askMembersEnabled?: boolean;
  askSharingPolicy?: "off" | "server" | "public";
};

const normalizeServerContext = (ctxRecord?: ServerContextSnapshot | null) => {
  const {
    context = "",
    defaultNotesChannelId = null,
    defaultTags = [],
    liveVoiceEnabled = false,
    liveVoiceCommandsEnabled = false,
    liveVoiceTtsVoice = null,
    chatTtsEnabled = false,
    chatTtsVoice = null,
    askMembersEnabled = true,
    askSharingPolicy = "server",
  } = ctxRecord ?? {};
  return {
    context,
    defaultNotesChannelId,
    defaultTags,
    liveVoiceEnabled,
    liveVoiceCommandsEnabled,
    liveVoiceTtsVoice,
    chatTtsEnabled,
    chatTtsVoice,
    askMembersEnabled,
    askSharingPolicy,
  };
};

const buildServerContextUpdate = (
  input: ServerContextUpdateInput,
): ServerContextUpdate => {
  const update: ServerContextUpdate = {};
  if (input.context !== undefined) update.context = input.context;
  if (input.defaultNotesChannelId !== undefined) {
    update.defaultNotesChannelId = input.defaultNotesChannelId;
  }
  if (input.defaultTags !== undefined) update.defaultTags = input.defaultTags;
  if (input.liveVoiceEnabled !== undefined) {
    update.liveVoiceEnabled = input.liveVoiceEnabled;
  }
  if (input.liveVoiceCommandsEnabled !== undefined) {
    update.liveVoiceCommandsEnabled = input.liveVoiceCommandsEnabled;
  }
  if (input.liveVoiceTtsVoice !== undefined) {
    update.liveVoiceTtsVoice = input.liveVoiceTtsVoice;
  }
  if (input.chatTtsEnabled !== undefined) {
    update.chatTtsEnabled = input.chatTtsEnabled;
  }
  if (input.chatTtsVoice !== undefined) {
    update.chatTtsVoice = input.chatTtsVoice;
  }
  if (input.askMembersEnabled !== undefined) {
    update.askMembersEnabled = input.askMembersEnabled;
  }
  if (input.askSharingPolicy !== undefined) {
    update.askSharingPolicy = input.askSharingPolicy;
  }
  return update;
};

const get = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    await ensureBotPresence(ctx, input.serverId);
    const ctxRecord = await fetchServerContext(input.serverId);
    return normalizeServerContext(ctxRecord);
  });

const set = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      context: z.string().optional(),
      defaultNotesChannelId: z.string().nullable().optional(),
      defaultTags: z.array(z.string()).optional(),
      liveVoiceEnabled: z.boolean().optional(),
      liveVoiceCommandsEnabled: z.boolean().optional(),
      liveVoiceTtsVoice: z.string().nullable().optional(),
      chatTtsEnabled: z.boolean().optional(),
      chatTtsVoice: z.string().nullable().optional(),
      askMembersEnabled: z.boolean().optional(),
      askSharingPolicy: z.enum(["off", "server", "public"]).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await ensureBotPresence(ctx, input.serverId);
    const update = buildServerContextUpdate(input);
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
