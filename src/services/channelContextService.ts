import { CONFIG_KEYS } from "../config/keys";
import type { ChannelContext } from "../types/db";
import {
  buildScopePrefix,
  clearConfigOverrideForScope,
  listConfigOverridesForScope,
  listConfigOverridesForScopePrefix,
  setConfigOverrideForScope,
} from "./configOverridesService";

const CHANNEL_CONTEXT_KEYS = new Set<string>([
  CONFIG_KEYS.context.instructions,
  CONFIG_KEYS.liveVoice.enabled,
  CONFIG_KEYS.liveVoice.commandsEnabled,
  CONFIG_KEYS.chatTts.enabled,
]);
const resolveLatestRecord = <T extends { updatedAt: string }>(records: T[]) =>
  records.reduce(
    (latest, record) =>
      !latest || record.updatedAt > latest.updatedAt ? record : latest,
    undefined as T | undefined,
  );

const coerceString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const coerceBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;

export type ChannelContextUpdate = {
  context?: string | null;
  liveVoiceEnabled?: boolean | null;
  liveVoiceCommandsEnabled?: boolean | null;
  chatTtsEnabled?: boolean | null;
};

export async function setChannelContext(
  guildId: string,
  channelId: string,
  userId: string,
  update: ChannelContextUpdate,
) {
  const scope = { scope: "channel", guildId, channelId } as const;
  const tasks: Promise<void>[] = [];

  if (update.context !== undefined) {
    const trimmed = update.context?.trim() ?? "";
    if (trimmed.length > 0) {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          CONFIG_KEYS.context.instructions,
          trimmed,
          userId,
        ),
      );
    } else {
      tasks.push(
        clearConfigOverrideForScope(scope, CONFIG_KEYS.context.instructions),
      );
    }
  }

  if (update.liveVoiceEnabled !== undefined) {
    if (update.liveVoiceEnabled === null) {
      tasks.push(
        clearConfigOverrideForScope(scope, CONFIG_KEYS.liveVoice.enabled),
      );
    } else {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          CONFIG_KEYS.liveVoice.enabled,
          update.liveVoiceEnabled,
          userId,
        ),
      );
    }
  }

  if (update.liveVoiceCommandsEnabled !== undefined) {
    if (update.liveVoiceCommandsEnabled === null) {
      tasks.push(
        clearConfigOverrideForScope(
          scope,
          CONFIG_KEYS.liveVoice.commandsEnabled,
        ),
      );
    } else {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          CONFIG_KEYS.liveVoice.commandsEnabled,
          update.liveVoiceCommandsEnabled,
          userId,
        ),
      );
    }
  }

  if (update.chatTtsEnabled !== undefined) {
    if (update.chatTtsEnabled === null) {
      tasks.push(
        clearConfigOverrideForScope(scope, CONFIG_KEYS.chatTts.enabled),
      );
    } else {
      tasks.push(
        setConfigOverrideForScope(
          scope,
          CONFIG_KEYS.chatTts.enabled,
          update.chatTtsEnabled,
          userId,
        ),
      );
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

export async function fetchChannelContext(guildId: string, channelId: string) {
  const overrides = await listConfigOverridesForScope({
    scope: "channel",
    guildId,
    channelId,
  });
  const relevant = overrides.filter((record) =>
    CHANNEL_CONTEXT_KEYS.has(record.configKey),
  );
  if (relevant.length === 0) return undefined;

  const latest = resolveLatestRecord(relevant);
  if (!latest) return undefined;

  const map = new Map(
    relevant.map((record) => [record.configKey, record.value]),
  );
  const context = coerceString(map.get(CONFIG_KEYS.context.instructions));
  const liveVoiceEnabled = coerceBoolean(
    map.get(CONFIG_KEYS.liveVoice.enabled),
  );
  const liveVoiceCommandsEnabled = coerceBoolean(
    map.get(CONFIG_KEYS.liveVoice.commandsEnabled),
  );
  const chatTtsEnabled = coerceBoolean(map.get(CONFIG_KEYS.chatTts.enabled));

  const next: ChannelContext = {
    guildId,
    channelId,
    updatedAt: latest.updatedAt,
    updatedBy: latest.updatedBy,
  };

  if (context) {
    next.context = context;
  }
  if (liveVoiceEnabled !== undefined) {
    next.liveVoiceEnabled = liveVoiceEnabled;
  }
  if (liveVoiceCommandsEnabled !== undefined) {
    next.liveVoiceCommandsEnabled = liveVoiceCommandsEnabled;
  }
  if (chatTtsEnabled !== undefined) {
    next.chatTtsEnabled = chatTtsEnabled;
  }

  return next;
}

export async function clearChannelContext(guildId: string, channelId: string) {
  const scope = { scope: "channel", guildId, channelId } as const;
  await Promise.all(
    Array.from(CHANNEL_CONTEXT_KEYS, (key) =>
      clearConfigOverrideForScope(scope, key),
    ),
  );
}

export async function listChannelContexts(guildId: string) {
  const overrides = await listConfigOverridesForScopePrefix(
    buildScopePrefix("channel", guildId),
  );
  const relevant = overrides.filter((record) =>
    CHANNEL_CONTEXT_KEYS.has(record.configKey),
  );
  if (relevant.length === 0) return [];

  const byChannel = new Map<string, typeof relevant>();
  relevant.forEach((record) => {
    const parts = record.scopeId.split("#");
    if (parts.length < 3) return;
    const channelId = parts.slice(2).join("#");
    const list = byChannel.get(channelId) ?? [];
    list.push(record);
    byChannel.set(channelId, list);
  });

  return Array.from(byChannel.entries()).flatMap(([channelId, records]) => {
    const latest = resolveLatestRecord(records);
    if (!latest) return [];
    const map = new Map(
      records.map((record) => [record.configKey, record.value]),
    );
    const context = coerceString(map.get(CONFIG_KEYS.context.instructions));
    const liveVoiceEnabled = coerceBoolean(
      map.get(CONFIG_KEYS.liveVoice.enabled),
    );
    const liveVoiceCommandsEnabled = coerceBoolean(
      map.get(CONFIG_KEYS.liveVoice.commandsEnabled),
    );
    const chatTtsEnabled = coerceBoolean(map.get(CONFIG_KEYS.chatTts.enabled));

    const next: ChannelContext = {
      guildId,
      channelId,
      updatedAt: latest.updatedAt,
      updatedBy: latest.updatedBy,
    };

    if (context) {
      next.context = context;
    }
    if (liveVoiceEnabled !== undefined) {
      next.liveVoiceEnabled = liveVoiceEnabled;
    }
    if (liveVoiceCommandsEnabled !== undefined) {
      next.liveVoiceCommandsEnabled = liveVoiceCommandsEnabled;
    }
    if (chatTtsEnabled !== undefined) {
      next.chatTtsEnabled = chatTtsEnabled;
    }

    return [next];
  });
}
