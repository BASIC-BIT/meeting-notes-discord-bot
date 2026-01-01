import { CONFIG_KEYS } from "../config/keys";
import type { TierLimits } from "./subscriptionService";
import {
  getSnapshotBoolean,
  getSnapshotString,
  resolveConfigSnapshot,
} from "./unifiedConfigService";

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
  const liveVoiceEnabledRaw = getSnapshotBoolean(
    snapshot,
    CONFIG_KEYS.liveVoice.enabled,
  );
  const liveVoiceCommandsRaw = getSnapshotBoolean(
    snapshot,
    CONFIG_KEYS.liveVoice.commandsEnabled,
  );
  const chatTtsEnabledRaw = getSnapshotBoolean(
    snapshot,
    CONFIG_KEYS.chatTts.enabled,
  );
  const liveVoiceEnabled = limits.liveVoiceEnabled && liveVoiceEnabledRaw;
  const liveVoiceCommandsEnabled =
    limits.liveVoiceEnabled && liveVoiceCommandsRaw;
  const chatTtsEnabled = limits.liveVoiceEnabled && chatTtsEnabledRaw;
  const liveVoiceTtsVoice = getSnapshotString(
    snapshot,
    CONFIG_KEYS.liveVoice.ttsVoice,
    { trim: true },
  );
  const chatTtsVoice = getSnapshotString(snapshot, CONFIG_KEYS.chatTts.voice, {
    trim: true,
  });
  return {
    liveVoiceEnabled,
    liveVoiceCommandsEnabled,
    chatTtsEnabled,
    liveVoiceTtsVoice,
    chatTtsVoice,
  };
}
