import { CONFIG_REGISTRY } from "../config/registry";
import type { ConfigTier, MeetingRuntimeConfig } from "../config/types";
import { resolveConfigSnapshot } from "./unifiedConfigService";
import {
  FAST_SILENCE_THRESHOLD,
  MAX_SNIPPET_LENGTH,
  MINIMUM_TRANSCRIPTION_LENGTH,
  SILENCE_THRESHOLD,
} from "../constants";

const getValue = (
  snapshot: Awaited<ReturnType<typeof resolveConfigSnapshot>>,
  key: string,
  fallback: unknown,
) => snapshot.values[key]?.value ?? fallback;

export async function resolveMeetingRuntimeConfig(input: {
  guildId: string;
  channelId: string;
  userId: string;
  tier?: ConfigTier;
}): Promise<MeetingRuntimeConfig> {
  const snapshot = await resolveConfigSnapshot({
    guildId: input.guildId,
    channelId: input.channelId,
    userId: input.userId,
    tier: input.tier,
  });

  return {
    transcription: {
      fastSilenceMs: Number(
        getValue(
          snapshot,
          "transcription.fastSilenceMs",
          FAST_SILENCE_THRESHOLD,
        ),
      ),
      slowSilenceMs: Number(
        getValue(snapshot, "transcription.slowSilenceMs", SILENCE_THRESHOLD),
      ),
      minSnippetSeconds: Number(
        getValue(
          snapshot,
          "transcription.minSnippetSeconds",
          MINIMUM_TRANSCRIPTION_LENGTH,
        ),
      ),
      maxSnippetMs: Number(
        getValue(snapshot, "transcription.maxSnippetMs", MAX_SNIPPET_LENGTH),
      ),
    },
    premiumTranscription: {
      enabled: Boolean(
        getValue(snapshot, "transcription.premium.enabled", false),
      ),
      cleanupEnabled: Boolean(
        getValue(snapshot, "transcription.premium.cleanup.enabled", true),
      ),
      coalesceModel: String(
        getValue(
          snapshot,
          "transcription.premium.coalesce.model",
          "gpt-5-mini",
        ),
      ),
    },
  };
}

export function getConfigRegistry() {
  return CONFIG_REGISTRY;
}
