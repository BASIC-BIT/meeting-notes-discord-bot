import { fetchServerContext } from "./appContextService";
import { fetchChannelContext } from "./channelContextService";
import type { TierLimits } from "./subscriptionService";

export type MeetingVoiceSettings = {
  liveVoiceEnabled: boolean;
  liveVoiceCommandsEnabled: boolean;
  chatTtsEnabled: boolean;
  liveVoiceTtsVoice?: string;
  chatTtsVoice?: string;
};

type VoiceToggleKey =
  | "liveVoiceEnabled"
  | "liveVoiceCommandsEnabled"
  | "chatTtsEnabled";

type VoiceToggleContext = {
  liveVoiceEnabled?: boolean;
  liveVoiceCommandsEnabled?: boolean;
  chatTtsEnabled?: boolean;
};

function resolveVoiceToggle(
  limits: TierLimits,
  serverContext: VoiceToggleContext | null | undefined,
  channelContext: VoiceToggleContext | null | undefined,
  key: VoiceToggleKey,
): boolean {
  if (!limits.liveVoiceEnabled) return false;
  const serverDefault = serverContext?.[key] ?? false;
  const override = channelContext?.[key];
  return override ?? serverDefault;
}

export async function resolveMeetingVoiceSettings(
  guildId: string,
  channelId: string,
  limits: TierLimits,
): Promise<MeetingVoiceSettings> {
  const [serverContext, channelContext] = await Promise.all([
    fetchServerContext(guildId),
    fetchChannelContext(guildId, channelId),
  ]);
  const liveVoiceEnabled = resolveVoiceToggle(
    limits,
    serverContext,
    channelContext,
    "liveVoiceEnabled",
  );
  const liveVoiceCommandsEnabled = resolveVoiceToggle(
    limits,
    serverContext,
    channelContext,
    "liveVoiceCommandsEnabled",
  );
  const chatTtsEnabled = resolveVoiceToggle(
    limits,
    serverContext,
    channelContext,
    "chatTtsEnabled",
  );
  return {
    liveVoiceEnabled,
    liveVoiceCommandsEnabled,
    chatTtsEnabled,
    liveVoiceTtsVoice: serverContext?.liveVoiceTtsVoice,
    chatTtsVoice: serverContext?.chatTtsVoice,
  };
}
