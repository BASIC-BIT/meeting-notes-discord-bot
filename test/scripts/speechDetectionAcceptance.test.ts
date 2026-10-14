import { DEFAULT_SPEECH_POLICY } from "../../src/services/speechDetectionPolicy";
import { serialize, deserialize } from "node:v8";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
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
  const results = cases.flatMap((c) =>
    [1, 2, 3].map((run) => ({
      caseId: c.id,
      sha256: c.sha256,
      run,
      label: c.label,
      tags: c.tags,
      familyId: c.familyId,
      speakerDeviceProfileId: c.speakerDeviceProfileId,
      status: "succeeded",
      text: c.label.kind === "speech" ? "hello" : "",
      requests: 1,
      submittedAudioSeconds: 2,
      audioSeconds: 2,
      durationMs: 20,
      score: { scored: true },
      assessment: {
        kind: c.label.kind === "speech" ? "speech" : "non_speech",
        policyFingerprint: policy.policyFingerprint,
      },
      stages: { assessmentMs: 10 },
    })),
  );
  const common = {
    version: 1,
    complete: true,
    manifestSha256,
    runs: 3,
    sourceSha256: { source: hash("code") },
    speechPolicy: policy,
    mode: "pipeline",
    passMode: "slow",
    prompt: "",
    model: "asr",
    policy: {},
    force: false,
    selection: { split: "holdout", batchSize: 25, batchIndex: 0 },
    results,
  };
  const baseline = { ...common, speechDetector: "off", speechMode: "off" };
  const candidate = {
    ...common,
    speechDetector: "production",
    speechMode: "enforce",
    results: deserialize(serialize(results)),
  };
  const detector = {
    ...common,
    providerRequests: 0,
    split: "holdout",
    results: deserialize(serialize(results)),
  };
  const review = {
    version: 1,
    manifestSha256,
    reviewedAt: "2026-10-13T12:00:00Z",
    holdoutUntouchedSinceFreeze: true,
    tuningFamilyIds: [] as string[],
  };
  const benchmark = {
    version: 1,
    complete: true,
    speechPolicy: policy,
    limits: { cpu: 0.5, memoryBytes: 1073741824 },
    durationSeconds: 120,
    fastPerSecond: 4,
    slowPerSecond: 1,
    coldStartMs: 20,
    steady: {
      availability: 1,
      phases: { fast: { p95Ms: 100 }, slow: { p95Ms: 200 } },
    },
    overheadBytes: 100000,
    addedEventLoopP95Ms: 1,
    buckets: [0.3, 2, 10, 60, 180].map((seconds) => ({
      seconds,
      phases: {
        fast: { p95Ms: 100, availability: 1 },
        slow: { p95Ms: 200, availability: 1 },
      },
    })),
    burst: { attempts: 10, queueFull: 5, failOpen: true },
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
            JSON.stringify({
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
            }),
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
  for (const r of f.baseline.results) {
    r.requests = 0;
    r.submittedAudioSeconds = 0;
  }
  const r = run(f);
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
