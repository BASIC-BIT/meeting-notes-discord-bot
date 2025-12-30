import { getServerContextRepository } from "../repositories/serverContextRepository";
import type { ServerContext } from "../types/db";
import { nowIso } from "../utils/time";

export type ServerContextUpdate = {
  context?: string;
  defaultNotesChannelId?: string | null;
  defaultTags?: string[];
  liveVoiceEnabled?: boolean;
  liveVoiceCommandsEnabled?: boolean;
  liveVoiceTtsVoice?: string | null;
  chatTtsEnabled?: boolean;
  chatTtsVoice?: string | null;
  askMembersEnabled?: boolean;
  askSharingPolicy?: "off" | "server" | "public" | null;
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
  const nextLiveVoiceCommandsEnabled =
    update.liveVoiceCommandsEnabled !== undefined
      ? update.liveVoiceCommandsEnabled
      : existing?.liveVoiceCommandsEnabled;
  const nextLiveVoiceTtsVoice =
    update.liveVoiceTtsVoice === null
      ? undefined
      : (update.liveVoiceTtsVoice ?? existing?.liveVoiceTtsVoice);
  const nextChatTtsEnabled =
    update.chatTtsEnabled !== undefined
      ? update.chatTtsEnabled
      : existing?.chatTtsEnabled;
  const nextChatTtsVoice =
    update.chatTtsVoice === null
      ? undefined
      : (update.chatTtsVoice ?? existing?.chatTtsVoice);
  const nextAskMembersEnabled =
    update.askMembersEnabled !== undefined
      ? update.askMembersEnabled
      : existing?.askMembersEnabled;
  const nextAskSharingPolicy =
    update.askSharingPolicy === null
      ? undefined
      : (update.askSharingPolicy ?? existing?.askSharingPolicy);

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
    ...(nextLiveVoiceCommandsEnabled !== undefined
      ? { liveVoiceCommandsEnabled: nextLiveVoiceCommandsEnabled }
      : {}),
    ...(nextLiveVoiceTtsVoice
      ? { liveVoiceTtsVoice: nextLiveVoiceTtsVoice }
      : {}),
    ...(nextChatTtsEnabled !== undefined
      ? { chatTtsEnabled: nextChatTtsEnabled }
      : {}),
    ...(nextChatTtsVoice ? { chatTtsVoice: nextChatTtsVoice } : {}),
    ...(nextAskMembersEnabled !== undefined
      ? { askMembersEnabled: nextAskMembersEnabled }
      : {}),
    ...(nextAskSharingPolicy ? { askSharingPolicy: nextAskSharingPolicy } : {}),
  };
  await getServerContextRepository().write(next);
}

export async function clearServerContextService(guildId: string) {
  await getServerContextRepository().remove(guildId);
}

export async function fetchServerContext(guildId: string) {
  return getServerContextRepository().get(guildId);
}
