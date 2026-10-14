import process from "node:process";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  hash,
  readJson,
  requireCompiled,
  writeJson,
  percentile,
} from "./evidence.mjs";
const { values } = parseArgs({
  options: Object.fromEntries(
    [
      "manifest",
      "review-evidence",
      "detector",
      "baseline",
      "candidate",
      "benchmark",
      "output",
    ].map((k) => [k, { type: "string" }]),
  ),
});
const ratio = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
const delta = (baseline, candidate) => ({
  baseline,
  candidate,
  absoluteChange:
    baseline.value === null || candidate.value === null
      ? null
      : candidate.value - baseline.value,
  relativeChange:
    baseline.value === null || candidate.value === null || baseline.value === 0
      ? null
      : (candidate.value - baseline.value) / baseline.value,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finite = (n) => Number.isFinite(n) && n >= 0;
async function main() {
  const report = {
    version: 1,
    status: "incomplete",
    machineVerified: [],
    failures: [],
    missing: [],
    attested: { finalHumanReviewRequired: true },
    costUsd: null,
    scorecard: Object.fromEntries(
      [
        "wer",
        "speechEmpty",
        "nonspeechFalsePositive",
        "providerRequests",
        "requestsPerDecodedMinute",
        "submittedSecondsPerDecodedMinute",
      ].map((metric) => [
        metric,
        {
          baseline: { numerator: null, denominator: null, value: null },
          candidate: { numerator: null, denominator: null, value: null },
          absoluteChange: null,
          relativeChange: null,
        },
      ]),
    ),
  };
  const check = (ok, name, incomplete = false) => {
    if (ok) report.machineVerified.push(name);
    else (incomplete ? report.missing : report.failures).push(name);
  };
  let benchmark;
  try {
    benchmark = await readJson(values.benchmark);
    check(
      benchmark.version === 1 &&
        benchmark.complete === true &&
        benchmark.limits?.cpu === 0.5 &&
        benchmark.limits?.memoryBytes === 1073741824 &&
        benchmark.durationSeconds >= 120 &&
        benchmark.fastPerSecond === 4 &&
        benchmark.slowPerSecond === 1,
      "constrained representative benchmark",
      true,
    );
    check(benchmark.steady?.availability >= 0.95, "steady availability >=95%");
    check(
      finite(benchmark.overheadBytes) &&
        benchmark.overheadBytes < 128 * 1024 * 1024,
      "detector overhead <128 MiB",
    );
    check(
      Number.isFinite(benchmark.addedEventLoopP95Ms) &&
        benchmark.addedEventLoopP95Ms < 20,
      "added event loop p95 <20ms",
    );
    for (const [phase, deadline] of [
      ["fast", 500],
      ["slow", 1500],
    ])
      check(
        finite(benchmark.steady?.phases?.[phase]?.p95Ms) &&
          benchmark.steady.phases[phase].p95Ms <= deadline,
        `${phase} warm p95 deadline`,
      );
    check(
      [0.3, 2, 10, 60, 180].every((s) =>
        benchmark.buckets?.some(
          (b) =>
            b.seconds === s &&
            ["fast", "slow"].every(
              (p) =>
                finite(b.phases?.[p]?.p95Ms) &&
                b.phases[p].p95Ms <= (p === "fast" ? 500 : 1500) &&
                b.phases[p].availability > 0,
            ),
        ),
      ),
      "all duration buckets meet warm phase deadlines",
    );
    check(
      benchmark.burst?.attempts === 10 &&
        benchmark.burst.queueFull >= 5 &&
        benchmark.burst.failOpen === true,
      "ten-job burst overflow fails open",
    );
    check(
      [0.3, 2, 10, 60, 180].every((seconds) =>
        benchmark.buckets?.some(
          (b) =>
            b.seconds === seconds &&
            ["fast", "slow"].every((phase) =>
              Number.isFinite(b.phases?.[phase]?.availability),
            ),
        ),
      ),
      "all duration buckets measured",
      true,
    );
    report.benchmark = benchmark;
  } catch {
    report.missing.push("missing or invalid benchmark evidence");
  }
  try {
    const { transcriptionCorpusSchema, referenceForCase } = requireCompiled(
      "./../evals/transcriptionCorpus.js",
    );
    const { DEFAULT_SPEECH_POLICY } = requireCompiled(
      "./speechDetectionPolicy.js",
    );
    const { scoreTranscription } = requireCompiled(
      "./../evals/transcriptionMetrics.js",
    );
    const bytes = await readFile(values.manifest),
      manifest = transcriptionCorpusSchema.parse(JSON.parse(bytes)),
      manifestSha256 = hash(bytes);
    report.manifestSha256 = manifestSha256;
    report.samples = {
      uniqueClips: manifest.cases.filter((c) => c.split === "holdout").length,
      humanReviewed: manifest.cases.filter(
        (c) => c.label.provenance === "human-reviewed",
      ).length,
      unreviewed: manifest.cases.filter((c) => c.label.kind === "unreviewed")
        .length,
    };
    const review = await readJson(values["review-evidence"]),
      detector = await readJson(values.detector);
    const load = async (file) => {
      const list = await readJson(file);
      if (
        !Array.isArray(list) ||
        !list.length ||
        !list.every((p) => typeof p === "string")
      )
        throw Error("invalid_list");
      return Promise.all(
        list.map((p) => readJson(path.resolve(path.dirname(file), p))),
      );
    };
    const baseline = await load(values.baseline),
      candidate = await load(values.candidate),
      cases = manifest.cases.filter((c) => c.split === "holdout");
    const speech = cases.filter((c) => c.label.kind === "speech"),
      nonspeech = cases.filter((c) => c.label.kind === "nonspeech");
    check(
      speech.length >= 100 && nonspeech.length >= 50,
      "minimum unique speech/nonspeech samples",
      true,
    );
    check(
      speech.filter((c) => c.tags.includes("quiet")).length >= 20 &&
        speech.filter((c) => c.tags.includes("short")).length >= 20,
      "minimum quiet/short speech samples",
      true,
    );
    check(
      cases.every((c) => c.familyId && c.speakerDeviceProfileId),
      "family and profile metadata",
      true,
    );
    check(
      new Set(speech.map((c) => c.speakerDeviceProfileId)).size >= 5,
      "five speech profiles",
      true,
    );
    check(
      new Set(manifest.cases.map((c) => c.sha256)).size ===
        manifest.cases.length,
      "unique audio hashes",
    );
    const tuning = new Set([
      ...manifest.cases
        .filter((c) => c.split === "tune")
        .map((c) => c.familyId),
      ...(review.tuningFamilyIds ?? []),
    ]);
    check(
      cases.every((c) => !tuning.has(c.familyId)),
      "no tune/holdout family leakage",
    );
    const human = cases.every(
      (c) =>
        c.label.kind !== "unreviewed" &&
        c.label.provenance === "human-reviewed",
    );
    check(human, "human-reviewed label provenance", true);
    const attested =
      review.version === 1 &&
      review.manifestSha256 === manifestSha256 &&
      Number.isFinite(Date.parse(review.reviewedAt)) &&
      review.holdoutUntouchedSinceFreeze === true &&
      Array.isArray(review.tuningFamilyIds) &&
      review.tuningFamilyIds.every(
        (f) => typeof f === "string" && f.length > 0,
      );
    check(attested, "review evidence bound to manifest", true);
    report.attested = {
      finalHumanReviewRequired: true,
      humanReviewClaim: human,
      holdoutUntouchedSinceFreeze: review.holdoutUntouchedSinceFreeze === true,
      reviewedAt: review.reviewedAt ?? null,
      truthAutomaticallyVerified: false,
    };
    report.manifestSha256 = manifestSha256;
    report.samples = {
      uniqueClips: cases.length,
      speech: speech.length,
      nonspeech: nonspeech.length,
      profiles: new Set(speech.map((c) => c.speakerDeviceProfileId)).size,
    };
    const flatten = (reports) =>
      reports.flatMap((p) =>
        p.results.map((r) => ({ ...r, phase: p.passMode, report: p })),
      );
    const before = flatten(baseline),
      after = flatten(candidate);
    const key = (r) => `${r.phase}|${r.caseId}|${r.run}`;
    const known = new Map(cases.map((c) => [c.id, c]));
    const signature = (p) => ({
      manifestSha256: p.manifestSha256,
      runs: p.runs,
      sourceSha256: p.sourceSha256,
      mode: p.mode,
      passMode: p.passMode,
      model: p.model,
      prompt: p.prompt,
      policy: p.policy,
      force: p.force,
    });
    for (const [name, reports, rows] of [
      ["baseline", baseline, before],
      ["candidate", candidate, after],
    ]) {
      check(
        reports.every(
          (p) =>
            p.version === 1 &&
            p.complete === true &&
            p.manifestSha256 === manifestSha256 &&
            p.runs === 3 &&
            p.mode === "pipeline" &&
            !p.force &&
            p.model &&
            p.sourceSha256 &&
            Object.keys(p.sourceSha256).length > 0 &&
            p.selection?.split === "holdout" &&
            !p.vadReport,
        ),
        `${name} complete matched pipeline reports`,
        true,
      );
      check(
        reports.every((p) =>
          name === "baseline"
            ? p.speechDetector === "off" && p.speechMode === "off"
            : p.speechDetector === "production" && p.speechMode === "enforce",
        ),
        `${name} detector selection`,
      );
      check(
        ["fast", "slow"].every((phase) =>
          reports.some((p) => p.passMode === phase),
        ),
        `${name} fast and slow phases`,
        true,
      );
      const sortedIds = cases
        .map((c) => c.id)
        .sort((a, b) => a.localeCompare(b, "en"));
      check(
        reports.every((p) => {
          const selection = p.selection;
          if (
            !selection ||
            !Number.isInteger(selection.batchSize) ||
            selection.batchSize < 1 ||
            selection.batchSize > 25 ||
            !Number.isInteger(selection.batchIndex) ||
            selection.batchIndex < 0 ||
            selection.totalSelectedCases !== cases.length
          )
            return false;
          const ids = sortedIds.slice(
            selection.batchSize * selection.batchIndex,
            selection.batchSize * (selection.batchIndex + 1),
          );
          return (
            ids.length > 0 &&
            same(ids, selection.selectedCaseIds) &&
            p.results.length === ids.length * p.runs &&
            p.results.every((r) => ids.includes(r.caseId))
          );
        }),
        `${name} deterministic batch provenance`,
        true,
      );
      const keys = new Set(rows.map(key));
      check(
        keys.size === rows.length &&
          rows.length === cases.length * 3 * 2 &&
          cases.every((c) =>
            ["fast", "slow"].every((phase) =>
              [1, 2, 3].every((run) => keys.has(`${phase}|${c.id}|${run}`)),
            ),
          ),
        `${name} exact case repetition coverage`,
        true,
      );
      check(
        rows.every((r) => {
          const c = known.get(r.caseId);
          return (
            c &&
            r.sha256 === c.sha256 &&
            same(r.label, c.label) &&
            same(r.tags, c.tags) &&
            r.familyId === c.familyId &&
            r.speakerDeviceProfileId === c.speakerDeviceProfileId &&
            ["succeeded", "skipped"].includes(r.status) &&
            typeof r.text === "string" &&
            r.score?.scored === true &&
            finite(r.requests) &&
            Number.isInteger(r.requests) &&
            finite(r.submittedAudioSeconds) &&
            finite(r.audioSeconds) &&
            r.audioSeconds > 0
          );
        }),
        `${name} validated rows`,
        true,
      );
    }
    const beforeMap = new Map(before.map((r) => [key(r), r]));
    check(
      after.every((r) => {
        const b = beforeMap.get(key(r));
        return (
          b &&
          same(signature(b.report), signature(r.report)) &&
          b.audioSeconds === r.audioSeconds
        );
      }),
      "identical pipeline source/config/prompt/model/repetitions",
    );
    const pipelineProvenance = (reports) =>
      reports.map((p) => ({
        manifestSha256: p.manifestSha256,
        sourceSha256: p.sourceSha256,
        runSha256: p.runSha256 ?? null,
        model: p.model,
        mode: p.mode,
        passMode: p.passMode,
        runs: p.runs,
        force: p.force,
        promptSha256: hash(p.prompt ?? ""),
        policySha256: hash(JSON.stringify(p.policy ?? null)),
        speechDetector: p.speechDetector,
        speechMode: p.speechMode,
        selection: p.selection,
      }));
    report.provenance = {
      speechPolicy: detector.speechPolicy,
      detectorCompiledSha256: detector.compiledSha256 ?? null,
      benchmarkCompiledSha256: benchmark?.compiledSha256 ?? null,
      pipeline: {
        baseline: pipelineProvenance(baseline),
        candidate: pipelineProvenance(candidate),
      },
    };
    const detectorRows = detector.results ?? [],
      dk = new Set(detectorRows.map((r) => `${r.caseId}|${r.run}`));
    check(
      detector.version === 1 &&
        detector.complete === true &&
        detector.providerRequests === 0 &&
        detector.manifestSha256 === manifestSha256 &&
        detector.split === "holdout" &&
        detector.runs === 3 &&
        dk.size === detectorRows.length &&
        detectorRows.length === cases.length * 3 &&
        cases.every((c) => [1, 2, 3].every((run) => dk.has(`${c.id}|${run}`))),
      "complete zero-provider detector coverage",
      true,
    );
    const fingerprint = detector.speechPolicy?.policyFingerprint,
      modelSha = detector.speechPolicy?.modelSha256;
    check(
      same(detector.speechPolicy, DEFAULT_SPEECH_POLICY) &&
        typeof fingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(fingerprint) &&
        typeof modelSha === "string" &&
        /^[a-f0-9]{64}$/.test(modelSha) &&
        candidate.every((p) => same(p.speechPolicy, detector.speechPolicy)) &&
        same(benchmark?.speechPolicy, detector.speechPolicy),
      "matched model/policy hashes",
    );
    check(
      detectorRows.every((r) => {
        const c = known.get(r.caseId);
        return (
          c &&
          r.sha256 === c.sha256 &&
          same(c.label, r.label) &&
          r.assessment?.policyFingerprint === fingerprint &&
          ["speech", "non_speech", "uncertain"].includes(r.assessment.kind)
        );
      }),
      "validated available detector assessments",
      true,
    );
    const rejectedSpeech = detectorRows.filter(
      (r) =>
        known.get(r.caseId)?.label.kind === "speech" &&
        r.assessment.kind === "non_speech",
    );
    check(rejectedSpeech.length === 0, "zero verified speech rejection");
    const admittedIds = new Set(
      before
        .filter(
          (r) =>
            known.get(r.caseId)?.label.kind === "nonspeech" &&
            r.status === "succeeded",
        )
        .map((r) => r.caseId),
    );
    const admitted = detectorRows.filter((r) => admittedIds.has(r.caseId));
    const rejected = admitted.filter((r) => r.assessment.kind === "non_speech");
    check(admitted.length > 0, "baseline-admitted nonspeech denominator", true);
    check(
      admitted.length > 0 && rejected.length / admitted.length >= 0.5,
      "at least half baseline-admitted nonspeech rejected",
    );
    function measures(rows) {
      const scored = rows.map((r) => ({
        ...r,
        score: scoreTranscription(
          referenceForCase(known.get(r.caseId)),
          r.text,
        ),
      }));
      const sp = scored.filter(
          (r) => known.get(r.caseId).label.kind === "speech",
        ),
        ns = scored.filter(
          (r) => known.get(r.caseId).label.kind === "nonspeech",
        );
      const seconds = rows.reduce((n, r) => n + r.audioSeconds, 0),
        submitted = rows.reduce((n, r) => n + r.submittedAudioSeconds, 0),
        requests = rows.reduce((n, r) => n + r.requests, 0);
      return {
        wer: ratio(
          sp.reduce((n, r) => n + r.score.wordErrors, 0),
          sp.reduce((n, r) => n + r.score.referenceWords, 0),
        ),
        speechEmpty: ratio(
          sp.filter((r) => r.text.trim() === "").length,
          sp.length,
        ),
        nonspeechFalsePositive: ratio(
          ns.filter((r) => r.text.trim() !== "").length,
          ns.length,
        ),
        providerRequests: ratio(requests, 1),
        requestsPerDecodedMinute: ratio(requests, seconds / 60),
        submittedSecondsPerDecodedMinute: ratio(submitted, seconds / 60),
        decodedSeconds: seconds,
        submittedSeconds: submitted,
        attempts: rows.length,
        uniqueClips: new Set(rows.map((r) => r.caseId)).size,
        endToEndP95Ms: percentile(rows.map((r) => r.durationMs).filter(finite)),
        assessmentP95Ms: percentile(
          rows.map((r) => r.stages?.assessmentMs).filter(finite),
        ),
        uncertainty: ratio(
          rows.filter((r) => r.assessment?.kind === "uncertain").length,
          rows.filter((r) => r.assessment).length,
        ),
        unavailability: ratio(
          rows.filter((r) => r.assessment?.kind === "unavailable").length,
          rows.filter((r) => r.assessment).length,
        ),
      };
    }
    if (
      !report.missing.some((s) => s.includes("rows") || s.includes("coverage"))
    ) {
      const b = measures(before),
        a = measures(after);
      const compare = (b, a) =>
        Object.fromEntries(
          [
            "wer",
            "speechEmpty",
            "nonspeechFalsePositive",
            "providerRequests",
            "requestsPerDecodedMinute",
            "submittedSecondsPerDecodedMinute",
          ].map((k) => [k, delta(b[k], a[k])]),
        );
      report.scorecard = compare(b, a);
      report.pipeline = { baseline: b, candidate: a };
      report.byGroup = Object.fromEntries(
        ["quiet", "short"].map((tag) => {
          const b = measures(before.filter((r) => r.tags.includes(tag))),
            a = measures(after.filter((r) => r.tags.includes(tag)));
          return [tag, { ...compare(b, a), baseline: b, candidate: a }];
        }),
      );
      report.byPhase = Object.fromEntries(
        ["fast", "slow"].map((phase) => [
          phase,
          compare(
            measures(before.filter((r) => r.phase === phase)),
            measures(after.filter((r) => r.phase === phase)),
          ),
        ]),
      );
      for (const phase of ["fast", "slow"]) {
        const phaseBefore = measures(before.filter((r) => r.phase === phase));
        const phaseAfter = measures(after.filter((r) => r.phase === phase));
        for (const metric of ["wer", "speechEmpty", "nonspeechFalsePositive"])
          check(
            phaseAfter[metric].value !== null &&
              phaseBefore[metric].value !== null &&
              phaseAfter[metric].value <= phaseBefore[metric].value,
            `${phase} no ${metric} regression`,
          );
      }
      report.byFamily = Object.fromEntries(
        [...new Set(cases.map((c) => c.familyId))].map((f) => [
          f,
          {
            ...compare(
              measures(before.filter((r) => r.familyId === f)),
              measures(after.filter((r) => r.familyId === f)),
            ),
            baseline: measures(before.filter((r) => r.familyId === f)),
            candidate: measures(after.filter((r) => r.familyId === f)),
          },
        ]),
      );
      for (const k of ["wer", "speechEmpty", "nonspeechFalsePositive"])
        check(
          a[k].value !== null &&
            b[k].value !== null &&
            a[k].value <= b[k].value,
          `no ${k} regression`,
        );
    }
    report.detector = {
      speechRejection: ratio(
        rejectedSpeech.length,
        detectorRows.filter((r) => known.get(r.caseId)?.label.kind === "speech")
          .length,
      ),
      baselineAdmittedNonspeechRejection: ratio(
        rejected.length,
        admitted.length,
      ),
      uncertainty: ratio(
        detectorRows.filter((r) => r.assessment.kind === "uncertain").length,
        detectorRows.length,
      ),
      unavailability: ratio(
        detectorRows.filter((r) => r.assessment.kind === "unavailable").length,
        detectorRows.length,
      ),
    };
    report.status = report.missing.length
      ? "incomplete"
      : report.failures.length
        ? "fail"
        : "pass";
  } catch {
    report.missing.push("missing or invalid evidence input");
  }
  if (values.output) await writeJson(path.resolve(values.output), report);
  console.log(
    JSON.stringify({
      status: report.status,
      failures: report.failures,
      missing: report.missing,
    }),
  );
  if (report.status !== "pass") process.exitCode = 1;
}
main().catch(() => {
  console.error(JSON.stringify({ category: "acceptance_failed" }));
  process.exitCode = 1;
});
