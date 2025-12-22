import { getServerContextRepository } from "../repositories/serverContextRepository";
import type { ServerContext } from "../types/db";
import { nowIso } from "../utils/time";

export type ServerContextUpdate = {
  context?: string;
  defaultNotesChannelId?: string | null;
  defaultTags?: string[];
  liveVoiceEnabled?: boolean;
};

export async function setServerContext(
  guildId: string,
  userId: string,
  update: ServerContextUpdate,
) {
  const existing = await getServerContextRepository().get(guildId);
  const nextContext =
    Object.hasOwn(update, "context") && update.context !== undefined
      ? update.context
      : (existing?.context ?? "");
  const nextDefaultNotesChannelId =
    update.defaultNotesChannelId === null
      ? undefined
      : (update.defaultNotesChannelId ?? existing?.defaultNotesChannelId);
  const nextDefaultTags =
    update.defaultTags !== undefined
      ? update.defaultTags.length > 0
        ? update.defaultTags
        : undefined
      : existing?.defaultTags;
  const nextLiveVoiceEnabled =
    update.liveVoiceEnabled !== undefined
      ? update.liveVoiceEnabled
      : existing?.liveVoiceEnabled;

  const next: ServerContext = {
    guildId,
    context: nextContext,
    updatedAt: nowIso(),
    updatedBy: userId,
    ...(nextDefaultNotesChannelId
      ? { defaultNotesChannelId: nextDefaultNotesChannelId }
      : {}),
    ...(nextDefaultTags ? { defaultTags: nextDefaultTags } : {}),
    ...(nextLiveVoiceEnabled !== undefined
      ? { liveVoiceEnabled: nextLiveVoiceEnabled }
      : {}),
  };
  await getServerContextRepository().write(next);
}

export async function clearServerContextService(guildId: string) {
  await getServerContextRepository().remove(guildId);
}

export async function fetchServerContext(guildId: string) {
  return getServerContextRepository().get(guildId);
}
