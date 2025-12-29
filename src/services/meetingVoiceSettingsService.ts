import { fetchServerContext } from "./appContextService";
import { fetchChannelContext } from "./channelContextService";
import type { TierLimits } from "./subscriptionService";

export type MeetingVoiceSettings = {
  liveVoiceEnabled: boolean;
  chatTtsEnabled: boolean;
  liveVoiceTtsVoice?: string;
  chatTtsVoice?: string;
};

export async function resolveMeetingVoiceSettings(
  guildId: string,
  channelId: string,
  limits: TierLimits,
): Promise<MeetingVoiceSettings> {
  const [serverContext, channelContext] = await Promise.all([
    fetchServerContext(guildId),
    fetchChannelContext(guildId, channelId),
  ]);
  const liveVoiceDefault = serverContext?.liveVoiceEnabled ?? false;
  const liveVoiceOverride = channelContext?.liveVoiceEnabled;
  const chatTtsDefault = serverContext?.chatTtsEnabled ?? false;
  const chatTtsOverride = channelContext?.chatTtsEnabled;
  const liveVoiceEnabled =
    limits.liveVoiceEnabled && (liveVoiceOverride ?? liveVoiceDefault);
  const chatTtsEnabled =
    limits.liveVoiceEnabled && (chatTtsOverride ?? chatTtsDefault);
  return {
    liveVoiceEnabled,
    chatTtsEnabled,
    liveVoiceTtsVoice: serverContext?.liveVoiceTtsVoice,
    chatTtsVoice: serverContext?.chatTtsVoice,
  };
}
