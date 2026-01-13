import type { MeetingRuntimeConfig } from "../src/config/types";
import type { MeetingData } from "../src/types/meeting-data";
import {
  FAST_SILENCE_THRESHOLD,
  MAX_SNIPPET_LENGTH,
  MINIMUM_TRANSCRIPTION_LENGTH,
  NOISE_GATE_APPLY_TO_FAST,
  NOISE_GATE_APPLY_TO_SLOW,
  NOISE_GATE_ENABLED,
  NOISE_GATE_MIN_ACTIVE_WINDOWS,
  NOISE_GATE_MIN_PEAK_ABOVE_NOISE_DB,
  NOISE_GATE_PEAK_DBFS,
  NOISE_GATE_WINDOW_MS,
  SILENCE_THRESHOLD,
} from "../src/constants";
import { applyTranscriptionGuards } from "../src/transcription";

describe("applyTranscriptionGuards", () => {
  const DEFAULT_NOISE_GATE_CONFIG = {
    enabled: NOISE_GATE_ENABLED,
    windowMs: NOISE_GATE_WINDOW_MS,
    peakDbfs: NOISE_GATE_PEAK_DBFS,
    minActiveWindows: NOISE_GATE_MIN_ACTIVE_WINDOWS,
    minPeakAboveNoiseDb: NOISE_GATE_MIN_PEAK_ABOVE_NOISE_DB,
    applyToFast: NOISE_GATE_APPLY_TO_FAST,
    applyToSlow: NOISE_GATE_APPLY_TO_SLOW,
  };

  const DEFAULT_TRANSCRIPTION_CONFIG: MeetingRuntimeConfig["transcription"] = {
    suppressionEnabled: false,
    fastSilenceMs: FAST_SILENCE_THRESHOLD,
    slowSilenceMs: SILENCE_THRESHOLD,
    minSnippetSeconds: MINIMUM_TRANSCRIPTION_LENGTH,
    maxSnippetMs: MAX_SNIPPET_LENGTH,
    fastFinalizationEnabled: false,
    interjectionEnabled: false,
    interjectionMinSpeakerSeconds: MINIMUM_TRANSCRIPTION_LENGTH,
    noiseGate: DEFAULT_NOISE_GATE_CONFIG,
  };

  const buildRuntimeConfig = (
    overrides: Partial<MeetingRuntimeConfig> = {},
  ): MeetingRuntimeConfig => {
    const transcriptionOverrides = overrides.transcription ?? {};
    const noiseGateOverrides = transcriptionOverrides.noiseGate ?? {};
    const noiseGate = { ...DEFAULT_NOISE_GATE_CONFIG, ...noiseGateOverrides };
    return {
      transcription: {
        ...DEFAULT_TRANSCRIPTION_CONFIG,
        ...transcriptionOverrides,
        noiseGate,
      },
      premiumTranscription: {
        enabled: false,
        cleanupEnabled: false,
        ...overrides.premiumTranscription,
      },
      dictionary: {
        maxEntries: 0,
        maxCharsTranscription: 0,
        maxCharsContext: 0,
        ...overrides.dictionary,
      },
      autoRecordCancellation: {
        enabled: false,
        ...overrides.autoRecordCancellation,
      },
      modelParams: overrides.modelParams,
      modelChoices: overrides.modelChoices,
    };
  };

  const baseMeeting = {
    guild: { name: "Test Guild" },
    voiceChannel: { name: "General" },
    dictionaryEntries: [],
  } as MeetingData;

  test("suppresses prompt-like output when suppression is enabled", () => {
    const meeting = {
      ...baseMeeting,
      runtimeConfig: {
        ...buildRuntimeConfig({
          transcription: {
            suppressionEnabled: true,
          },
        }),
      },
    } as MeetingData;

    const prompt = "Server Name: Test Guild\nChannel: General";

    const result = applyTranscriptionGuards(meeting, prompt, prompt, prompt, {
      userId: "user-1",
      timestamp: 0,
      audioSeconds: 0.5,
      audioBytes: 48000,
    });

    expect(result.text).toBe("");
    expect(result.flags).toEqual(
      expect.arrayContaining(["prompt_like", "prompt_suppressed"]),
    );
  });

  test("returns raw transcription when suppression is disabled", () => {
    const meeting = {
      ...baseMeeting,
      runtimeConfig: {
        ...buildRuntimeConfig({
          transcription: {
            suppressionEnabled: false,
          },
        }),
      },
    } as MeetingData;

    const prompt = "Server Name: Test Guild\nChannel: General";

    const result = applyTranscriptionGuards(meeting, prompt, prompt, prompt, {
      userId: "user-1",
      timestamp: 0,
      audioSeconds: 0.5,
      audioBytes: 48000,
    });

    expect(result.text).toBe(prompt);
    expect(result.flags).toEqual([]);
  });
});
