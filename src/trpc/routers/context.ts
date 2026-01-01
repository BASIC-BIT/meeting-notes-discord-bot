import { z } from "zod";
import { SERVER_CONTEXT_KEYS } from "../../config/keys";
import { resolveConfigSnapshot } from "../../services/unifiedConfigService";
import {
  clearConfigOverrideForScope,
  setConfigOverrideForScope,
} from "../../services/configOverridesService";
import { normalizeTags, parseTags } from "../../utils/tags";
import { ensureBotPresence } from "./ensureBotPresence";
import { manageGuildProcedure, router } from "../trpc";

const resolveStringValue = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const get = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    await ensureBotPresence(ctx, input.serverId);
    const snapshot = await resolveConfigSnapshot({ guildId: input.serverId });
    const contextValue =
      resolveStringValue(snapshot.values[SERVER_CONTEXT_KEYS.context]?.value) ??
      "";
    const defaultNotesChannelId = resolveStringValue(
      snapshot.values[SERVER_CONTEXT_KEYS.defaultNotesChannelId]?.value,
    );
    const defaultTagsValue =
      snapshot.values[SERVER_CONTEXT_KEYS.defaultTags]?.value;
    const defaultTags =
      typeof defaultTagsValue === "string"
        ? (parseTags(defaultTagsValue) ?? [])
        : [];
    const liveVoiceEnabled = Boolean(
      snapshot.values[SERVER_CONTEXT_KEYS.liveVoiceEnabled]?.value,
    );
    const liveVoiceCommandsEnabled = Boolean(
      snapshot.values[SERVER_CONTEXT_KEYS.liveVoiceCommandsEnabled]?.value,
    );
    const liveVoiceTtsVoice = resolveStringValue(
      snapshot.values[SERVER_CONTEXT_KEYS.liveVoiceTtsVoice]?.value,
    );
    const chatTtsEnabled = Boolean(
      snapshot.values[SERVER_CONTEXT_KEYS.chatTtsEnabled]?.value,
    );
    const chatTtsVoice = resolveStringValue(
      snapshot.values[SERVER_CONTEXT_KEYS.chatTtsVoice]?.value,
    );
    const askMembersEnabled = Boolean(
      snapshot.values[SERVER_CONTEXT_KEYS.askMembersEnabled]?.value,
    );
    const askSharingPolicyValue =
      snapshot.values[SERVER_CONTEXT_KEYS.askSharingPolicy]?.value;
    const askSharingPolicy =
      askSharingPolicyValue === "off" ||
      askSharingPolicyValue === "server" ||
      askSharingPolicyValue === "public"
        ? askSharingPolicyValue
        : "server";
    return {
      context: contextValue,
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
    const scope = { scope: "server", guildId: input.serverId } as const;
    const tasks: Promise<void>[] = [];
    if (input.context !== undefined) {
      const trimmed = input.context.trim();
      if (trimmed.length > 0) {
        tasks.push(
          setConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.context,
            trimmed,
            ctx.user.id,
          ),
        );
      } else {
        tasks.push(
          clearConfigOverrideForScope(scope, SERVER_CONTEXT_KEYS.context),
        );
      }
    }
    if (input.defaultNotesChannelId !== undefined) {
      if (input.defaultNotesChannelId) {
        tasks.push(
          setConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.defaultNotesChannelId,
            input.defaultNotesChannelId,
            ctx.user.id,
          ),
        );
      } else {
        tasks.push(
          clearConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.defaultNotesChannelId,
          ),
        );
      }
    }
    if (input.defaultTags !== undefined) {
      const normalized = normalizeTags(input.defaultTags);
      if (normalized) {
        tasks.push(
          setConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.defaultTags,
            normalized.join(", "),
            ctx.user.id,
          ),
        );
      } else {
        tasks.push(
          clearConfigOverrideForScope(scope, SERVER_CONTEXT_KEYS.defaultTags),
        );
      }
    }
    if (input.liveVoiceEnabled !== undefined) {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          SERVER_CONTEXT_KEYS.liveVoiceEnabled,
          input.liveVoiceEnabled,
          ctx.user.id,
        ),
      );
    }
    if (input.liveVoiceCommandsEnabled !== undefined) {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          SERVER_CONTEXT_KEYS.liveVoiceCommandsEnabled,
          input.liveVoiceCommandsEnabled,
          ctx.user.id,
        ),
      );
    }
    if (input.liveVoiceTtsVoice !== undefined) {
      if (input.liveVoiceTtsVoice) {
        tasks.push(
          setConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.liveVoiceTtsVoice,
            input.liveVoiceTtsVoice,
            ctx.user.id,
          ),
        );
      } else {
        tasks.push(
          clearConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.liveVoiceTtsVoice,
          ),
        );
      }
    }
    if (input.chatTtsEnabled !== undefined) {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          SERVER_CONTEXT_KEYS.chatTtsEnabled,
          input.chatTtsEnabled,
          ctx.user.id,
        ),
      );
    }
    if (input.chatTtsVoice !== undefined) {
      if (input.chatTtsVoice) {
        tasks.push(
          setConfigOverrideForScope(
            scope,
            SERVER_CONTEXT_KEYS.chatTtsVoice,
            input.chatTtsVoice,
            ctx.user.id,
          ),
        );
      } else {
        tasks.push(
          clearConfigOverrideForScope(scope, SERVER_CONTEXT_KEYS.chatTtsVoice),
        );
      }
    }
    if (input.askMembersEnabled !== undefined) {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          SERVER_CONTEXT_KEYS.askMembersEnabled,
          input.askMembersEnabled,
          ctx.user.id,
        ),
      );
    }
    if (input.askSharingPolicy !== undefined) {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          SERVER_CONTEXT_KEYS.askSharingPolicy,
          input.askSharingPolicy,
          ctx.user.id,
        ),
      );
    }
    if (tasks.length === 0) {
      return { ok: true };
    }
    await Promise.all(tasks);
    return { ok: true };
  });

const clear = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await ensureBotPresence(ctx, input.serverId);
    const scope = { scope: "server", guildId: input.serverId } as const;
    await Promise.all(
      Object.values(SERVER_CONTEXT_KEYS).map((key) =>
        clearConfigOverrideForScope(scope, key),
      ),
    );
    return { ok: true };
  });

export const contextRouter = router({
  get,
  set,
  clear,
});
