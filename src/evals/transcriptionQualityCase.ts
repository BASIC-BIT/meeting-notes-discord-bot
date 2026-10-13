import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  MINIMUM_TRANSCRIPTION_LENGTH,
  RECORD_SAMPLE_RATE,
} from "../constants";
import {
  DEFAULT_NOISE_GATE_CONFIG,
  evaluateNoiseGate,
  isNoiseGateEnabled,
} from "../utils/audioNoiseGate";
import {
  resolveTranscriptionGuardConfig,
  selectTranscription,
  type RawTranscriptionCandidate,
} from "../services/transcriptionSelectionService";
import type { TranscriptionEvalPolicy } from "./transcriptionCorpus";
import type { TranscriptionVadDecision } from "./transcriptionVadReport";
import {
  scoreTranscription,
  type TranscriptionScore,
} from "./transcriptionMetrics";

export type TranscriptionQualityMode = "provider" | "pipeline" | "preflight";
export type TranscriptionQualityRun = {
  status: "succeeded" | "skipped" | "eligible" | "failed";
  reason?:
    | "minimum_duration"
    | "noise_gate"
    | "vad"
    | "request_error"
    | "budget_exhausted";
  audioSeconds: number;
  submittedAudioSeconds: number;
  requests: number;
  durationMs: number;
  text?: string;
  selectedId?: "prompt" | "no_prompt" | "none";
  candidates: {
    id: "prompt" | "no_prompt";
    raw: RawTranscriptionCandidate;
    flags: string[];
    text: string;
  }[];
  score: TranscriptionScore;
  noiseMetrics: ReturnType<typeof evaluateNoiseGate>["metrics"];
  vad?: TranscriptionVadDecision;
  voteDecision?: Awaited<
    ReturnType<typeof selectTranscription>
  >["voteDecision"];
};

export class TranscriptionBudgetExhausted extends Error {}

// Input is the same s16le/48kHz/stereo PCM that Discord capture sends to the gates.
export async function runTranscriptionQualityCase(input: {
  pcm: Buffer;
  reference?: string;
  prompt: string;
  passMode: "fast" | "slow";
  mode: TranscriptionQualityMode;
  policy: TranscriptionEvalPolicy;
  force: boolean;
  vad?: TranscriptionVadDecision;
  transcribe: (prompt?: string) => Promise<RawTranscriptionCandidate>;
}): Promise<TranscriptionQualityRun> {
  const started = Date.now();
  const audioSeconds =
    input.pcm.length / (RECORD_SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
  const gateConfig = {
    ...DEFAULT_NOISE_GATE_CONFIG,
    ...input.policy.noiseGate,
  };
  const gate = evaluateNoiseGate(input.pcm, gateConfig);
  const result: TranscriptionQualityRun = {
    status: "eligible",
    audioSeconds,
    submittedAudioSeconds: 0,
    requests: 0,
    durationMs: 0,
    candidates: [],
    score: { scored: false },
    noiseMetrics: gate.metrics,
    vad: input.vad,
  };
  const finish = () => ({ ...result, durationMs: Date.now() - started });
  if (input.mode !== "provider" && !input.force) {
    const reason =
      audioSeconds <=
      (input.policy.minSnippetSeconds ?? MINIMUM_TRANSCRIPTION_LENGTH)
        ? "minimum_duration"
        : isNoiseGateEnabled(gateConfig, input.passMode) &&
            !gate.shouldTranscribe
          ? "noise_gate"
          : input.vad && !input.vad.shouldTranscribe
            ? "vad"
            : undefined;
    if (reason) {
      Object.assign(result, {
        status: "skipped",
        reason,
        text: "",
        score: scoreTranscription(input.reference, ""),
      });
      return finish();
    }
  }
  if (input.mode === "preflight") return finish();
  const request = async (prompt?: string) => {
    // The callback enforces the global budget before making an HTTP request.
    // A rejected HTTP request counts too; a budget refusal does not.
    result.requests++;
    result.submittedAudioSeconds += audioSeconds;
    try {
      return await input.transcribe(prompt);
    } catch (error) {
      if (error instanceof TranscriptionBudgetExhausted) {
        result.requests--;
        result.submittedAudioSeconds -= audioSeconds;
      }
      throw error;
    }
  };
  try {
    if (input.mode === "provider") {
      const raw = await request(input.prompt.trim() || undefined);
      result.candidates.push({ id: "prompt", raw, flags: [], text: raw.text });
      result.text = raw.text;
      result.selectedId = "prompt";
    } else {
      const rawCandidates: RawTranscriptionCandidate[] = [];
      const guardConfig = resolveTranscriptionGuardConfig(
        input.policy,
        input.force ? false : undefined,
      );
      const selection = await selectTranscription({
        transcribe: async (prompt) => {
          const raw = await request(prompt);
          rawCandidates.push(raw);
          return raw;
        },
        prompt: input.prompt.trim() || undefined,
        passMode: input.passMode,
        voteEnabled: input.policy.voteEnabled ?? true,
        guardConfig,
        audioSeconds,
        noiseGateMetrics:
          input.pcm.length &&
          ((isNoiseGateEnabled(gateConfig, input.passMode) && !input.force) ||
            guardConfig.suppressionEnabled)
            ? gate.metrics
            : undefined,
        onCandidate: (candidate) =>
          result.candidates.push({
            id: candidate.candidateId,
            raw: rawCandidates[rawCandidates.length - 1],
            flags: candidate.guardResult.flags,
            text: candidate.guardResult.text,
          }),
      });
      result.text = selection.selected.guardResult.text;
      result.selectedId = selection.selected.candidateId;
      result.voteDecision = selection.voteDecision;
    }
    result.status = "succeeded";
    result.score = scoreTranscription(input.reference, result.text);
  } catch (error) {
    result.status = "failed";
    result.reason =
      error instanceof TranscriptionBudgetExhausted
        ? "budget_exhausted"
        : "request_error";
    // Partial candidates are retained, but a failed run is never graded as silence.
  }
  return finish();
}
