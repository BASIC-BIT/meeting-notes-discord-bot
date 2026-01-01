import { CONFIG_KEYS } from "../config/keys";
import type { TierLimits } from "./subscriptionService";
import { resolveConfigSnapshot } from "./unifiedConfigService";

export type MeetingVoiceSettings = {
  liveVoiceEnabled: boolean;
  liveVoiceCommandsEnabled: boolean;
  chatTtsEnabled: boolean;
  liveVoiceTtsVoice?: string;
  chatTtsVoice?: string;
};

export async function resolveMeetingVoiceSettings(
  guildId: string,
  channelId: string,
  limits: TierLimits,
): Promise<MeetingVoiceSettings> {
  const snapshot = await resolveConfigSnapshot({ guildId, channelId });
  const resolveBoolean = (key: string) => Boolean(snapshot.values[key]?.value);
  const liveVoiceEnabledRaw = resolveBoolean(CONFIG_KEYS.liveVoice.enabled);
  const liveVoiceCommandsRaw = resolveBoolean(
    CONFIG_KEYS.liveVoice.commandsEnabled,
  );
  const chatTtsEnabledRaw = resolveBoolean(CONFIG_KEYS.chatTts.enabled);
  const liveVoiceEnabled = limits.liveVoiceEnabled && liveVoiceEnabledRaw;
  const liveVoiceCommandsEnabled =
    limits.liveVoiceEnabled && liveVoiceCommandsRaw;
  const chatTtsEnabled = limits.liveVoiceEnabled && chatTtsEnabledRaw;
  const liveVoiceTtsVoiceValue =
    snapshot.values[CONFIG_KEYS.liveVoice.ttsVoice]?.value;
  const chatTtsVoiceValue = snapshot.values[CONFIG_KEYS.chatTts.voice]?.value;
  const liveVoiceTtsVoice =
    typeof liveVoiceTtsVoiceValue === "string" &&
    liveVoiceTtsVoiceValue.trim().length > 0
      ? liveVoiceTtsVoiceValue
      : undefined;
  const chatTtsVoice =
    typeof chatTtsVoiceValue === "string" && chatTtsVoiceValue.trim().length > 0
      ? chatTtsVoiceValue
      : undefined;
  return {
    liveVoiceEnabled,
    liveVoiceCommandsEnabled,
    chatTtsEnabled,
    liveVoiceTtsVoice,
    chatTtsVoice,
  };
}
