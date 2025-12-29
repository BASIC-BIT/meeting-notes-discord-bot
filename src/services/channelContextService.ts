import { getChannelContextRepository } from "../repositories/channelContextRepository";
import { nowIso } from "../utils/time";

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
  const repo = getChannelContextRepository();
  const existing = await repo.get(guildId, channelId);
  const nextContext =
    update.context === null ? undefined : (update.context ?? existing?.context);
  const nextLiveVoiceEnabled =
    update.liveVoiceEnabled === null
      ? undefined
      : (update.liveVoiceEnabled ?? existing?.liveVoiceEnabled);
  const nextLiveVoiceCommandsEnabled =
    update.liveVoiceCommandsEnabled === null
      ? undefined
      : (update.liveVoiceCommandsEnabled ?? existing?.liveVoiceCommandsEnabled);
  const nextChatTtsEnabled =
    update.chatTtsEnabled === null
      ? undefined
      : (update.chatTtsEnabled ?? existing?.chatTtsEnabled);

  if (
    !nextContext &&
    nextLiveVoiceEnabled === undefined &&
    nextLiveVoiceCommandsEnabled === undefined &&
    nextChatTtsEnabled === undefined
  ) {
    await repo.remove(guildId, channelId);
    return;
  }

  await repo.write({
    guildId,
    channelId,
    context: nextContext,
    liveVoiceEnabled: nextLiveVoiceEnabled,
    liveVoiceCommandsEnabled: nextLiveVoiceCommandsEnabled,
    chatTtsEnabled: nextChatTtsEnabled,
    updatedAt: nowIso(),
    updatedBy: userId,
  });
}

export async function fetchChannelContext(guildId: string, channelId: string) {
  return getChannelContextRepository().get(guildId, channelId);
}

export async function clearChannelContext(guildId: string, channelId: string) {
  await getChannelContextRepository().remove(guildId, channelId);
}

export async function listChannelContexts(guildId: string) {
  return getChannelContextRepository().listByGuild(guildId);
}
