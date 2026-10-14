import { DEFAULT_SPEECH_POLICY } from "../../src/services/speechDetectionPolicy";
import { serialize, deserialize } from "node:v8";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const sourceFiles = [
  "src/constants.ts",
  "src/metrics.ts",
  "src/utils/audioNoiseGate.ts",
  "src/utils/transcriptionGuards.ts",
  "src/utils/transcriptionVote.ts",
  "src/utils/transcriptionText.ts",
  "src/utils/text.ts",
  "src/services/transcriptionAudioService.ts",
  "src/services/transcriptionInputService.ts",
  "src/services/speechDetectionService.ts",
  "src/services/speechDetectionPolicy.ts",
  "src/services/speechDetectionWorker.ts",
  "src/services/speechDetectionCore.ts",
  "src/services/speechDetectionTypes.ts",
  "src/services/transcriptionSelectionService.ts",
  "src/services/openaiClient.ts",
  "src/services/modelFactory.ts",
  "src/services/configService.ts",
  "src/evals/transcriptionCorpus.ts",
  "src/evals/transcriptionMetrics.ts",
  "src/evals/transcriptionQualityCase.ts",
  "src/evals/transcriptionQualityEval.ts",
  "src/evals/transcriptionVadReport.ts",
  "src/evals/transcriptionImplementation.ts",
];
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === "object"
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const assessment = (kind: string) => ({
  kind,
  policyFingerprint: DEFAULT_SPEECH_POLICY.policyFingerprint,
  metrics: {
    peakSpeechProbability: kind === "speech" ? 0.9 : 0.1,
    maxConsecutiveSpeechFrames: kind === "speech" ? 2 : 0,
    scannedFrames: 2,
    totalFrames: 2,
    gain: 1,
  },
});
function fixture() {
  const cases = Array.from({ length: 150 }, (_, i) => ({
    id: `clip${i}`,
    file: `clip${i}.wav`,
    sha256: hash(String(i)),
    split: "holdout",
    familyId: `family${i}`,
    speakerDeviceProfileId: `profile${i % 5}`,
    tags: i < 20 ? ["quiet", "short"] : [],
    label:
      i < 100
        ? { kind: "speech", transcript: "hello", provenance: "human-reviewed" }
        : { kind: "nonspeech", provenance: "human-reviewed" },
  }));
  const manifest = {
    version: 1,
    name: "acceptance fixture",
    prompt: "",
    cases,
  };
  const manifestSha256 = hash(JSON.stringify(manifest));
  const policy = DEFAULT_SPEECH_POLICY;
  const sourceSha256 = Object.fromEntries(sourceFiles.map((f) => [f, hash(f)]));
  const compiledSha256 = Object.fromEntries(
    sourceFiles.map((f) => [
      f.replace("src/", "").replace(/\.ts$/, ".js"),
      hash(`compiled:${f}`),
    ]),
  );
  const build = {
    version: 1,
    sourceSha256,
    compiledSha256,
    toolchain: {
      typescriptVersion: "6.0.3",
      tsconfigSha256: hash("tsconfig"),
      packageSha256: hash("package"),
      lockSha256: hash("lock"),
    },
  };
  const implementation = {
    version: 1,
    loader: "compiled",
    sourceSha256,
    compiledSha256,
    build,
    buildAssociationSha256: hash(stable(build)),
  };
  const results = cases.flatMap((c) =>
    [1, 2, 3].map((run) => ({
      caseId: c.id,
      sha256: c.sha256,
      run,
      split: c.split,
      label: c.label,
      tags: c.tags,
      familyId: c.familyId,
      speakerDeviceProfileId: c.speakerDeviceProfileId,
      status: "succeeded",
      text: c.label.kind === "speech" ? "hello" : "",
      reason: undefined as string | undefined,
      requests: 1,
      submittedAudioSeconds: 2,
      audioSeconds: 2,
      durationMs: 20,
      score: { scored: true },
      assessment: undefined as ReturnType<typeof assessment> | undefined,
      admission: undefined as
        | {
            kind: string;
            assessment: ReturnType<typeof assessment>;
            coverage: {
              pcmSha256: string;
              audioBytes: number;
              policyFingerprint: string;
            };
          }
        | undefined,
      stages: { assessmentMs: 10 },
    })),
  );
  const common = {
    version: 1,
    complete: true,
    manifestSha256,
    runs: 3,
    sourceSha256,
    compiledSha256,
    implementation,
    speechPolicy: policy,
    mode: "pipeline",
    passMode: "slow",
    prompt: "",
    model: "asr",
    policy: {} as { minSnippetSeconds?: number },
    force: false,
    maxRequests: 150,
    selection: { split: "holdout", batchSize: 25, batchIndex: 0 },
    results,
  };
  const baseline = { ...common, speechDetector: "off", speechMode: "off" };
  const candidate = {
    ...common,
    speechDetector: "production",
    speechMode: "enforce",
    results: deserialize(serialize(results)) as typeof results,
  };
  candidate.results.forEach((r) => {
    r.assessment = assessment(
      r.label.kind === "speech" ? "speech" : "non_speech",
    );
    r.admission = {
      kind: "assessed",
      assessment: r.assessment,
      coverage: {
        pcmSha256: hash(r.caseId),
        audioBytes: 384000,
        policyFingerprint: policy.policyFingerprint,
      },
    };
    if (r.label.kind === "nonspeech") {
      r.status = "skipped";
      r.reason = "non_speech";
      r.requests = 0;
      r.submittedAudioSeconds = 0;
    }
  });
  const detector = {
    ...common,
    providerRequests: 0,
    split: "holdout",
    phase: "slow",
    warmed: true,
    warmMs: 20,
    results: results.map((r) => ({
      ...r,
      assessment: assessment(
        r.label.kind === "speech" ? "speech" : "non_speech",
      ),
    })),
  };
  const review = {
    version: 1,
    manifestSha256,
    reviewedAt: "2026-10-13T12:00:00Z",
    holdoutUntouchedSinceFreeze: true,
    tuningFamilyIds: [] as string[],
  };
  const row = (phase: string, sequence: number, off = false) => ({
    phase,
    sequence,
    control: sequence % 2 === 0 ? "speech" : "nonspeech",
    durationMs: 100,
    assessment: off
      ? { kind: "off" }
      : assessment(sequence % 2 === 0 ? "speech" : "non_speech"),
  });
  const summarize = (rows: ReturnType<typeof row>[]) => ({
    attempts: rows.length,
    availability: rows.length ? 1 : null,
    p95Ms: rows.length ? 100 : null,
    allOutcomesP95Ms: rows.length ? 100 : null,
    unavailable: 0,
    queueFull: 0,
  });
  const measured = (rows: ReturnType<typeof row>[]) => ({
    ...summarize(rows),
    rows,
    phases: Object.fromEntries(
      ["fast", "slow"].map((p) => [
        p,
        summarize(rows.filter((r) => r.phase === p)),
      ]),
    ),
  });
  const schedule = Array.from({ length: 120 }, (_, second) => [
    { phase: "fast", at: second * 1000 },
    { phase: "slow", at: second * 1000 },
    ...[250, 500, 750].map((delta) => ({
      phase: "fast",
      at: second * 1000 + delta,
    })),
  ]).flat();
  const benchmark = {
    version: 1,
    complete: true,
    implementation,
    compiledSha256,
    speechPolicy: policy,
    limits: { cpu: 0.5, memoryBytes: 1073741824, source: "cgroup-v1" },
    nodeVersion: "v24.15.0",
    durationSeconds: 120,
    fastPerSecond: 4,
    slowPerSecond: 1,
    providerRequests: 0,
    warmed: true,
    coldStartMs: 20,
    steadyWorkerRestarts: 0,
    isolatedWorkerStarts: 10,
    fixtureSha256: {
      "yes-normal.wav": hash("speech-fixture"),
      "tune-tone.wav": hash("tone-fixture"),
    },
    baseline: {
      ...measured(schedule.map((job, i) => row(job.phase, i, true))),
      peakRss: 80000000,
      eventLoopP95Ms: 10,
    },
    steady: {
      ...measured(schedule.map((job, i) => row(job.phase, i))),
      peakRss: 80100000,
      eventLoopP95Ms: 11,
    },
    overheadBytes: 100000,
    addedEventLoopP95Ms: 1,
    buckets: [0.3, 2, 10, 60, 180].map((seconds) => {
      const rows = ["fast", "slow"].flatMap((phase) =>
        [0, 1, 2].flatMap((run) =>
          [0, 1].map((kind) => ({
            ...row(phase, run * 2 + kind),
            run,
            control: kind === 0 ? "speech" : "nonspeech",
          })),
        ),
      );
      return { seconds, rows, phases: measured(rows).phases };
    }),
    burst: {
      ...summarize(Array.from({ length: 10 }, (_, i) => row("slow", i))),
      attempts: 10,
      availability: 0.5,
      unavailable: 5,
      queueFull: 5,
      failOpen: true,
      rows: Array.from({ length: 10 }, (_, i) => ({
        ...row("slow", i),
        control: "nonspeech",
        assessment:
          i < 5
            ? assessment("non_speech")
            : {
                kind: "unavailable",
                reason: "queue_full",
                policyFingerprint: policy.policyFingerprint,
              },
      })),
    },
  };
  return { manifest, review, baseline, candidate, detector, benchmark };
}
function run(f: ReturnType<typeof fixture>, perfectFastBaseline = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "acceptance-"));
  try {
    for (const [k, v] of Object.entries(f))
      writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v));
    for (const k of ["baseline", "candidate"] as const) {
      const files: string[] = [];
      const ids = [...new Set(f[k].results.map((r) => r.caseId))].sort((a, b) =>
        a.localeCompare(b, "en"),
      );
      for (const phase of ["fast", "slow"])
        for (let index = 0; index < Math.ceil(ids.length / 25); index++) {
          const selectedCaseIds = ids.slice(index * 25, (index + 1) * 25);
          const rows = f[k].results.filter((r) =>
            selectedCaseIds.includes(r.caseId),
          );
          const file = path.join(dir, `${k}-${phase}-${index}.json`);
          writeFileSync(
            file,
            JSON.stringify(
              (() => {
                const report = {
                  ...f[k],
                  passMode: phase,
                  selection: {
                    ...f[k].selection,
                    batchIndex: index,
                    selectedCaseIds,
                    totalSelectedCases: ids.length,
                  },
                  results:
                    perfectFastBaseline && k === "baseline" && phase === "fast"
                      ? rows.map((r) => ({
                          ...r,
                          text: r.label.kind === "speech" ? "hello" : "",
                        }))
                      : rows,
                };
                const orderedCases = selectedCaseIds.map((id) =>
                  f.manifest.cases.find((c) => c.id === id),
                );
                return {
                  ...report,
                  summary: {
                    requests: report.results.reduce(
                      (n, r) => n + r.requests,
                      0,
                    ),
                    submittedAudioSeconds: report.results.reduce(
                      (n, r) => n + r.submittedAudioSeconds,
                      0,
                    ),
                    observedAudioSeconds: report.results.reduce(
                      (n, r) => n + r.audioSeconds,
                      0,
                    ),
                  },
                  runSha256: hash(
                    stable({
                      sourceSha256: report.sourceSha256,
                      cases: orderedCases,
                      runs: report.runs,
                      policy: report.policy,
                      prompt: report.prompt,
                      mode: report.mode,
                      passMode: phase,
                      speechDetector: report.speechDetector,
                      speechMode: report.speechMode,
                      implementation: report.implementation,
                    }),
                  ),
                };
              })(),
            ),
          );
          files.push(file);
        }
      writeFileSync(path.join(dir, `${k}-list.json`), JSON.stringify(files));
    }
    const out = path.join(dir, "scorecard.json");
    const proc = spawnSync(
      process.execPath,
      [
        "scripts/speech-detection/check-acceptance.mjs",
        "--manifest",
        path.join(dir, "manifest.json"),
        "--review-evidence",
        path.join(dir, "review.json"),
        "--detector",
        path.join(dir, "detector.json"),
        "--baseline",
        path.join(dir, "baseline-list.json"),
        "--candidate",
        path.join(dir, "candidate-list.json"),
        "--benchmark",
        path.join(dir, "benchmark.json"),
        "--output",
        out,
      ],
      { encoding: "utf8" },
    );
    return {
      status: proc.status,
      report: JSON.parse(readFileSync(out, "utf8")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("complete matched evidence passes with attestation separate from verification", () => {
  const r = run(fixture());
  expect(r.report.benchmarkEvidence.problems).toEqual([]);
  expect(r.report.missing).toEqual([]);
  expect(r.report.failures).toEqual([]);
  expect(r.status).toBe(0);
  expect(r.report.status).toBe("pass");
  expect(r.report.attested.finalHumanReviewRequired).toBe(true);
});
test.each([
  "leak",
  "duplicate",
  "profiles",
  "speech",
  "rejection",
  "quality",
  "empty",
  "false-positive",
  "incomplete",
  "matching",
  "review",
  "budget",
  "missing-row",
  "bucket-budget",
  "nan-budget",
  "missing-benchmark",
  "insufficient-speech",
  "insufficient-quiet",
  "missing-provenance",
  "wrong-hash",
  "duplicate-row",
  "preflight",
  "unscored",
])("rejects %s even when other evidence looks perfect", (kind) => {
  const f = fixture();
  switch (kind) {
    case "leak":
      f.review.tuningFamilyIds = ["family1"];
      break;
    case "duplicate":
      f.manifest.cases[1].sha256 = f.manifest.cases[0].sha256;
      break;
    case "profiles":
      f.manifest.cases.forEach((c) => (c.speakerDeviceProfileId = "one"));
      break;
    case "speech":
      f.detector.results[0].assessment.kind = "non_speech";
      break;
    case "rejection":
      f.detector.results.forEach((r) => (r.assessment.kind = "uncertain"));
      break;
    case "quality":
      f.candidate.results[0].text = "wrong";
      f.candidate.results[0].requests = 0;
      break;
    case "empty":
      f.candidate.results[0].text = "";
      break;
    case "false-positive":
      f.candidate.results[300].text = "invented";
      f.candidate.results[300].status = "succeeded";
      f.candidate.results[300].reason = undefined;
      f.candidate.results[300].requests = 1;
      f.candidate.results[300].submittedAudioSeconds = 2;
      f.candidate.results[300].assessment = assessment("uncertain");
      f.candidate.results[300].admission!.assessment =
        f.candidate.results[300].assessment;
      break;
    case "incomplete":
      f.candidate.complete = false;
      break;
    case "matching":
      f.candidate.model = "other";
      break;
    case "review":
      f.review.holdoutUntouchedSinceFreeze = false;
      break;
    case "budget":
      f.benchmark.overheadBytes = 128 * 1024 * 1024;
      break;
    case "phase-quality":
      f.baseline.results[1].text = "wrong";
      f.candidate.results[0].text = "wrong";
      break;
    case "bucket-budget":
      f.benchmark.buckets[0].phases.fast.p95Ms = 501;
      break;
    case "nan-budget":
      f.benchmark.addedEventLoopP95Ms = Number.NaN;
      break;
    case "missing-benchmark":
      f.benchmark.complete = false;
      break;
    case "insufficient-speech":
      f.manifest.cases.splice(0, 1);
      break;
    case "insufficient-quiet":
      f.manifest.cases[0].tags = [];
      break;
    case "missing-provenance":
      f.manifest.cases[0].label.provenance = "synthetic";
      break;
    case "wrong-hash":
      f.detector.results[0].sha256 = hash("different");
      break;
    case "duplicate-row":
      f.candidate.results[0] = f.candidate.results[1];
      break;
    case "preflight":
      f.candidate.mode = "preflight";
      break;
    case "unscored":
      f.candidate.results[0].score.scored = false;
      break;
    case "missing-row":
      f.candidate.results.pop();
      break;
  }
  expect(run(f).status).not.toBe(0);
});
test("zero baseline reports undefined relative change and money as null", () => {
  const f = fixture();
  for (const side of [f.baseline, f.candidate]) {
    side.policy = { minSnippetSeconds: 3 };
    for (const r of side.results) {
      r.status = "skipped";
      r.reason = "minimum_duration";
      r.text = "";
      r.requests = 0;
      r.submittedAudioSeconds = 0;
      r.assessment = undefined;
      r.admission = undefined;
    }
  }
  const r = run(f);
  expect(r.status).not.toBe(0);
  expect(r.report.status).toBe("incomplete");
  expect(r.report.scorecard.providerRequests.relativeChange).toBeNull();
  expect(r.report.costUsd).toBeNull();
});

test("one phase regression cannot hide behind another phase improvement", () => {
  const f = fixture();
  f.baseline.results[0].text = "wrong";
  f.baseline.results[1].text = "wrong";
  f.candidate.results[0].text = "wrong";
  const result = run(f, true);
  expect(result.status).not.toBe(0);
  expect(result.report.failures).toContain("fast no wer regression");
  expect(result.report.scorecard.wer.absoluteChange).toBe(0);
});

test("comparison report retains matched pipeline and detector provenance without prompt content", () => {
  const f = fixture();
  f.baseline.prompt = "private prompt fixture";
  f.candidate.prompt = "private prompt fixture";
  const result = run(f);
  expect(result.status).toBe(0);
  expect(result.report.provenance.speechPolicy).toEqual(DEFAULT_SPEECH_POLICY);
  for (const mode of ["baseline", "candidate"] as const) {
    const reports = result.report.provenance.pipeline[mode];
    expect(reports).toHaveLength(12);
    expect(reports[0]).toMatchObject({
      sourceSha256: f[mode].sourceSha256,
      model: "asr",
      mode: "pipeline",
      passMode: "fast",
      promptSha256: hash("private prompt fixture"),
      policySha256: hash(JSON.stringify(f[mode].policy)),
      speechDetector: f[mode].speechDetector,
      speechMode: f[mode].speechMode,
      selection: { split: "holdout", batchSize: 25, batchIndex: 0 },
    });
  }
  expect(JSON.stringify(result.report)).not.toContain("private prompt fixture");
});

test.each([
  "raw-rows",
  "phase-count",
  "control-count",
  "edited-availability",
  "rss-summary",
  "event-loop-summary",
  "latency-summary",
  "burst-rows",
  "bucket-repeats",
  "missing-compiled",
  "compiled-mismatch",
  "partial-source",
  "build-source-mismatch",
  "source-loader",
  "zero-sdk-success",
  "excess-phase-work",
  "submitted-seconds",
  "paid-skip",
  "budget",
  "row-policy",
])("rejects inconsistent acceptance evidence: %s", (kind) => {
  const f = fixture();
  switch (kind) {
    case "raw-rows":
      Reflect.deleteProperty(f.benchmark.steady, "rows");
      break;
    case "phase-count":
      f.benchmark.steady.rows[0].phase = "slow";
      break;
    case "control-count":
      f.benchmark.steady.rows[0].control = "nonspeech";
      break;
    case "edited-availability":
      f.benchmark.steady.rows[0].assessment = {
        kind: "unavailable",
        reason: "timeout",
        policyFingerprint: DEFAULT_SPEECH_POLICY.policyFingerprint,
      };
      break;
    case "rss-summary":
      f.benchmark.overheadBytes = 1;
      break;
    case "event-loop-summary":
      f.benchmark.addedEventLoopP95Ms = 0;
      break;
    case "latency-summary":
      f.benchmark.steady.phases.fast.p95Ms = 1;
      break;
    case "burst-rows":
      Reflect.deleteProperty(f.benchmark.burst, "rows");
      break;
    case "bucket-repeats":
      f.benchmark.buckets[0].rows.pop();
      break;
    case "missing-compiled":
      Reflect.deleteProperty(f.detector, "compiledSha256");
      break;
    case "compiled-mismatch":
      f.detector.compiledSha256 = {
        ...f.detector.compiledSha256,
        "services/speechDetectionService.js": hash("old"),
      };
      break;
    case "partial-source":
      f.candidate.sourceSha256 = { source: hash("fake") };
      break;
    case "build-source-mismatch":
      f.candidate.implementation = deserialize(
        serialize(f.candidate.implementation),
      );
      f.candidate.implementation.build.sourceSha256[
        "src/services/speechDetectionService.ts"
      ] = hash("old");
      break;
    case "source-loader":
      f.candidate.implementation = {
        ...f.candidate.implementation,
        loader: "source",
      };
      break;
    case "zero-sdk-success":
      f.candidate.results[0].requests = 0;
      f.candidate.results[0].submittedAudioSeconds = 0;
      break;
    case "excess-phase-work":
      f.candidate.results[0].requests = 3;
      f.candidate.results[0].submittedAudioSeconds = 6;
      break;
    case "submitted-seconds":
      f.candidate.results[0].submittedAudioSeconds = 99;
      break;
    case "paid-skip":
      f.candidate.results[300].requests = 1;
      f.candidate.results[300].submittedAudioSeconds = 2;
      break;
    case "budget":
      f.candidate.maxRequests = 1;
      break;
    case "row-policy":
      f.candidate.results[0].assessment!.policyFingerprint =
        hash("other policy");
      break;
  }
  expect(run(f).status).not.toBe(0);
});

test("candidate rejection of already-empty verified speech fails both pipeline phase gates", () => {
  const f = fixture();
  f.baseline.results[0].text = "";
  const r = f.candidate.results[0];
  r.text = "";
  r.status = "skipped";
  r.reason = "non_speech";
  r.requests = 0;
  r.submittedAudioSeconds = 0;
  r.assessment = assessment("non_speech");
  r.admission!.assessment = r.assessment;
  const result = run(f);
  expect(result.status).not.toBe(0);
  expect(result.report.detector.pipelineSpeechRejection).toMatchObject({
    numerator: 2,
    denominator: 600,
  });
  expect(
    result.report.detector.pipelineSpeechRejectionByPhase.fast.numerator,
  ).toBe(1);
  expect(
    result.report.detector.pipelineSpeechRejectionByPhase.slow.numerator,
  ).toBe(1);
  expect(
    result.report.detector.pipelineSpeechRejectionByGroup.quiet.numerator,
  ).toBe(2);
});
