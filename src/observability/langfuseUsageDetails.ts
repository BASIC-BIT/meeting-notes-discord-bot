export const LANGFUSE_AUDIO_SECONDS_USAGE_KEY = "input_audio_seconds";

export function buildLangfuseTranscriptionUsageDetails(
  audioSeconds?: number,
): Record<string, number> | undefined {
  if (typeof audioSeconds !== "number" || !Number.isFinite(audioSeconds)) {
    return undefined;
  }
  if (audioSeconds <= 0) {
    return undefined;
  }
  const rounded = Number(audioSeconds.toFixed(3));
  if (rounded <= 0) {
    return undefined;
  }
  return { [LANGFUSE_AUDIO_SECONDS_USAGE_KEY]: rounded };
}
