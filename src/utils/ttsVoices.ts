export const DEFAULT_TTS_VOICE = "alloy" as const;

export const TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number];

export const TTS_VOICE_OPTIONS = TTS_VOICES.map((voice) => ({
  value: voice,
  label: voice.slice(0, 1).toUpperCase() + voice.slice(1),
}));

export function normalizeTtsVoice(
  value: string | null | undefined,
): TtsVoice | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return (TTS_VOICES as readonly string[]).includes(normalized)
    ? (normalized as TtsVoice)
    : undefined;
}

export function isSupportedTtsVoice(
  value: string | null | undefined,
): value is TtsVoice {
  return !!normalizeTtsVoice(value);
}

export function resolveTtsVoice(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
): TtsVoice {
  return (
    normalizeTtsVoice(preferred) ||
    normalizeTtsVoice(fallback) ||
    DEFAULT_TTS_VOICE
  );
}
