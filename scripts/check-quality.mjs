#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRatchetArgs } from "./ratchet-common.mjs";
import { resolveMergeBase, SUBPROCESS_TIMEOUT_MS } from "./quality-git.mjs";

export const GATES = [
  ["duplication", "dup-gate.mjs"],
  ["complexity", "complexity-gate.mjs"],
  ["file-size", "file-size-gate.mjs"],
];
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isText = (value) => typeof value === "string" && value.length > 0;

const isLine = (value) => isCount(value) && value > 0;
const isRange = (f, start, end) =>
  isLine(f[start]) && isLine(f[end]) && f[end] >= f[start];

function validComparison(f, fields) {
  if (f.verdict === "NEW") return fields.every(([, base]) => f[base] === null);
  return (
    f.verdict === "GREW" &&
    fields.every(([, base]) => isCount(f[base])) &&
    fields.some(([current, base]) => f[current] > f[base])
  );
}

const findingValidators = {
  duplication: (f) =>
    isText(f.a) &&
    isText(f.b) &&
    isRange(f, "as", "ae") &&
    isRange(f, "bs", "be") &&
    isLine(f.lines) &&
    isLine(f.tokens) &&
    ["added-twice", "duplicates-existing"].includes(f.verdict),
  complexity: (f) =>
    isText(f.file) &&
    isText(f.key) &&
    isRange(f, "start", "end") &&
    isLine(f.cyclomatic) &&
    isCount(f.cognitive) &&
    validComparison(f, [
      ["cyclomatic", "baseCyclomatic"],
      ["cognitive", "baseCognitive"],
    ]),
  "file-size": (f) =>
    isText(f.file) &&
    isLine(f.lines) &&
    validComparison(f, [["lines", "baseLines"]]),
};

function validateFindings(name, report) {
  const valid = findingValidators[name];
  if (
    !valid ||
    !Array.isArray(report.findings) ||
    !report.findings.every((f) => f && valid(f))
  )
    throw new Error("Invalid scanner findings");
  if (report.findings.length && (!report.changedFiles || !report.scanned))
    throw new Error("Findings contradict scanner counts");
}

function validateGateReport(name, report, exitCode) {
  if (!report || !["base", "mergeBase"].every((key) => isText(report[key])))
    throw new Error("Missing scanner baseline metadata");
  if (!["changedFiles", "scanned"].every((key) => isCount(report[key])))
    throw new Error("Invalid scanner counts");
  validateFindings(name, report);
  if (Boolean(report.findings.length) !== Boolean(exitCode))
    throw new Error("Scanner findings contradict its exit code");
  if (report.preExisting !== undefined && !isCount(report.preExisting))
    throw new Error("Invalid pre-existing count");
}

export function parseScannerResult(name, raw) {
  const failed = (error) => ({ name, exitCode: 2, report: null, error });
  if (raw.signal || ![0, 1].includes(raw.status))
    return failed(
      raw.error?.message ||
        raw.stderr ||
        "Scanner exited " + raw.status + " " + (raw.signal ?? ""),
    );
  try {
    const report = JSON.parse(raw.stdout);
    validateGateReport(name, report, raw.status);
    return { name, exitCode: raw.status, report, error: null };
  } catch (error) {
    return failed(error.message);
  }
}

export function validateQualityReport(report) {
  if (
    report?.schemaVersion !== 1 ||
    !Array.isArray(report.scanners) ||
    report.scanners.length !== GATES.length
  )
    throw new Error("Incomplete quality report");
  const names = report.scanners
    .map((s) => s.name)
    .sort()
    .join(",");
  if (
    names !==
    GATES.map(([name]) => name)
      .sort()
      .join(",")
  )
    throw new Error("Missing or duplicate scanner");
  for (const scan of report.scanners) {
    if (![0, 1, 2].includes(scan.exitCode))
      throw new Error("Invalid scanner exit");
    if (scan.exitCode === 2) {
      if (!isText(scan.error)) throw new Error("Missing operational error");
    } else validateGateReport(scan.name, scan.report, scan.exitCode);
  }
  const baselines = report.scanners
    .filter((s) => s.exitCode !== 2)
    .map((s) => JSON.stringify([s.report.base, s.report.mergeBase]));
  if (new Set(baselines).size > 1)
    throw new Error("Scanner baselines disagree");
  if (
    report.strictExitCode !==
    Math.max(...report.scanners.map((s) => s.exitCode))
  )
    throw new Error("Strict exit contradicts scanner outcomes");
  return report;
}

function failedReport(error) {
  return {
    schemaVersion: 1,
    scanners: GATES.map(([name]) => ({
      name,
      exitCode: 2,
      report: null,
      error,
    })),
    strictExitCode: 2,
  };
}

export async function runQuality({ repo = process.cwd(), base = null } = {}) {
  repo = resolve(repo);
  const baseline = resolveMergeBase(repo, base);
  if (!baseline) return failedReport("Cannot resolve comparison baseline");
  const scanners = GATES.map(([name, file]) =>
    parseScannerResult(
      name,
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL(file, import.meta.url)),
          "--repo",
          repo,
          "--base",
          baseline.mergeBase,
          "--json",
        ],
        {
          cwd: repo,
          encoding: "utf8",
          timeout: 2 * SUBPROCESS_TIMEOUT_MS + 30_000,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        },
      ),
    ),
  );
  const report = {
    schemaVersion: 1,
    scanners,
    strictExitCode: Math.max(...scanners.map((s) => s.exitCode)),
  };
  try {
    return validateQualityReport(report);
  } catch (error) {
    return failedReport(error.message);
  }
}

function render(report) {
  const advice = {
    duplication: "Reuse the existing implementation or extract shared code.",
    complexity: "Simplify the function.",
    "file-size": "Split the file by responsibility.",
  };
  return report.scanners
    .map((scan) =>
      [
        scan.name +
          ": " +
          (scan.exitCode === 2
            ? scan.error
            : scan.report.findings.length + " regression(s)"),
        ...(scan.report?.findings ?? []).map((f) => "  " + JSON.stringify(f)),
        ...(scan.exitCode === 1 ? [advice[scan.name]] : []),
      ].join("\n"),
    )
    .join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseRatchetArgs(argv);
  if (opts.help) {
    console.log(
      "check-quality: --base <ref> --repo <path> --json. Local checks are always strict.",
    );
    return 0;
  }
  const report = opts.error ? failedReport(opts.error) : await runQuality(opts);
  console.log(opts.json ? JSON.stringify(report, null, 2) : render(report));
  return report.strictExitCode;
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
