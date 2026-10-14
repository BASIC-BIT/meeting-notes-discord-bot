import { writeFile } from "node:fs/promises";
import { runTranscriptionQualityEval } from "../../src/evals/transcriptionQualityEval";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTranscriptionQualityCase } from "../../src/evals/transcriptionQualityCase";
import { selectCorpusBatch } from "../../src/evals/transcriptionCorpus";
import type {
  SpeechAssessment,
  SpeechDetector,
} from "../../src/services/speechDetectionTypes";
const pcm = Buffer.alloc(48000 * 4);
for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(4000, i);
const options = {
  pcm,
  prompt: "",
  passMode: "slow" as const,
  policy: {},
  force: false,
};
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "vad-eval-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const production = (assessment: SpeechAssessment) => ({
  mode: "enforce" as const,
  pcmFile: path.join(dir, "input.pcm"),
  wavFile: path.join(dir, "input.wav"),
  policyFingerprint: "test",
  detector: {
    warm: async () => true,
    shutdown: async () => {},
    assess: async () => assessment,
  } satisfies SpeechDetector,
});
test("productionDetectorSkipsWithoutInventingSuccessfulSpeechScores", async () => {
  const result = await runTranscriptionQualityCase({
    ...options,
    mode: "pipeline",
    production: production({
      kind: "non_speech",
      policyFingerprint: "test",
      metrics: {
        peakSpeechProbability: 0,
        maxConsecutiveSpeechFrames: 0,
        scannedFrames: 1,
        totalFrames: 1,
        gain: 1,
      },
    }),
    transcribe: async () => ({ text: "invented" }),
  });
  expect(result).toMatchObject({
    status: "skipped",
    requests: 0,
    score: { scored: false },
  });
});
test("unavailableAssessmentStillCallsProvider", async () => {
  const result = await runTranscriptionQualityCase({
    ...options,
    mode: "pipeline",
    production: production({
      kind: "unavailable",
      reason: "worker_error",
      policyFingerprint: "test",
    }),
    transcribe: async () => ({ text: "hello" }),
  });
  expect(result).toMatchObject({
    status: "succeeded",
    requests: 1,
    assessment: { kind: "unavailable" },
  });
});
test("preflight eligible remains unscored", async () => {
  const result = await runTranscriptionQualityCase({
    ...options,
    mode: "preflight",
    reference: "hello",
    production: production({
      kind: "unavailable",
      reason: "not_ready",
      policyFingerprint: "test",
    }),
    transcribe: async () => {
      throw Error("forbidden");
    },
  });
  expect(result).toMatchObject({
    status: "eligible",
    requests: 0,
    score: { scored: false },
  });
});
test("batch ordering neither loses duplicates nor changes labels and hashes", () => {
  const cases = Array.from({ length: 53 }, (_, i) => ({
    id: `case-${String(52 - i).padStart(2, "0")}`,
    sha256: String(i),
    label: { kind: "speech" },
  }));
  const batches = [0, 1, 2].flatMap((index) =>
    selectCorpusBatch(cases, 25, index),
  );
  expect(batches).toEqual([...cases].sort((a, b) => a.id.localeCompare(b.id)));
  expect(() => selectCorpusBatch(cases, 25, 3)).toThrow();
  expect(() => selectCorpusBatch(cases, 26, 0)).toThrow();
});

test("sanitizes provider status without retaining private error text", async () => {
  const result = await runTranscriptionQualityCase({
    ...options,
    mode: "pipeline",
    transcribe: async () => {
      throw Object.assign(
        new Error("private https://secret.example/audio?token=sensitive"),
        { status: 429 },
      );
    },
  });
  expect(result.error).toEqual({ category: "request_error", status: 429 });
  expect(JSON.stringify(result)).not.toContain("secret.example");
});

test("invalid batch and conflicting VAD options stop before source decode or provider setup", async () => {
  const manifest = path.join(dir, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      name: "test",
      cases: [
        {
          id: "one",
          file: "missing.wav",
          sha256: "a".repeat(64),
          split: "holdout",
          label: { kind: "unreviewed" },
        },
      ],
    }),
  );
  await expect(
    runTranscriptionQualityEval(["--manifest", manifest, "--batch-index", "1"]),
  ).rejects.toThrow("Invalid corpus batch");
  await expect(
    runTranscriptionQualityEval([
      "--manifest",
      manifest,
      "--speech-detector",
      "production",
      "--vad-report",
      "missing.json",
    ]),
  ).rejects.toThrow("conflicts");
});
test("25 slow cases repeated three times require no more than 150 SDK attempts", async () => {
  let total = 0;
  for (let i = 0; i < 75; i++) {
    const r = await runTranscriptionQualityCase({
      ...options,
      prompt: "Dictionary: The Den",
      mode: "pipeline",
      transcribe: async () => {
        total++;
        return { text: "The Den", logprobs: [{ logprob: -3 }] };
      },
    });
    expect(r.requests).toBe(2);
  }
  expect(total).toBe(150);
});

test("shadow submits provider work before detector completion", async () => {
  let finish!: (value: SpeechAssessment) => void;
  const pending = new Promise<SpeechAssessment>((resolve) => {
    finish = resolve;
  });
  const detector: SpeechDetector = {
    warm: async () => true,
    shutdown: async () => {},
    assess: () => pending,
  };
  const result = await runTranscriptionQualityCase({
    ...options,
    mode: "pipeline",
    production: {
      ...production({
        kind: "unavailable",
        reason: "not_ready",
        policyFingerprint: "test",
      }),
      mode: "shadow",
      detector,
    },
    transcribe: async () => {
      finish({
        kind: "unavailable",
        reason: "timeout",
        policyFingerprint: "test",
      });
      return { text: "hello" };
    },
  });
  expect(result.requests).toBe(1);
  expect(result.assessment).toMatchObject({
    kind: "unavailable",
    reason: "timeout",
  });
});
