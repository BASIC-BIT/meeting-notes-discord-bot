import { validateQualityReport } from "./check-quality.mjs";

function nextFence(line, current) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return current;
  if (!current) return match[1];
  return match[1][0] === current[0] &&
    match[1].length >= current.length &&
    !match[2].trim()
    ? null
    : current;
}

export function extractRationale(body) {
  const lines = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/);
  let fence = null,
    start = null,
    end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const before = fence;
    fence = nextFence(lines[i], fence);
    if (before || fence) continue;
    if (start === null && lines[i].trimEnd() === "## Quality exception") {
      start = i + 1;
      continue;
    }
    if (start !== null && /^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return start === null
    ? null
    : lines.slice(start, end).join("\n").trim() || null;
}

function validateMetadata(scanned, current, report) {
  if (!scanned || !current) throw new Error("Missing PR metadata");
  if (
    !["headSha", "baseRef", "baseSha", "treeSha"].every(
      (key) => typeof scanned[key] === "string" && scanned[key].length > 0,
    )
  )
    throw new Error("Invalid scanned revision");
  if (
    !["headSha", "baseRef", "baseSha"].every(
      (key) => typeof current[key] === "string" && current[key].length > 0,
    )
  )
    throw new Error("Invalid current revision");
  if (
    typeof current.body !== "string" ||
    !Array.isArray(current.labels) ||
    !current.labels.every((label) => typeof label === "string")
  )
    throw new Error("Invalid current exception metadata");
  if (
    report.scanners.some(
      (s) => s.exitCode !== 2 && s.report.mergeBase !== scanned.baseSha,
    )
  )
    throw new Error("Report baseline does not match scanned revision");
}

export function evaluatePolicy({
  report,
  scanned,
  current,
  checkerTestsPassed,
}) {
  const result = (exitCode, outcome, message, rationale = null) => ({
    exitCode,
    outcome,
    rationale,
    message,
  });
  try {
    validateQualityReport(report);
    if (!checkerTestsPassed || report.strictExitCode === 2)
      return result(
        2,
        "error",
        "Checker tests or a scanner failed operationally. Exceptions do not apply.",
      );
    validateMetadata(scanned, current, report);
  } catch (error) {
    return result(2, "error", error.message);
  }
  if (
    ["headSha", "baseRef", "baseSha"].some(
      (key) => scanned[key] !== current[key],
    )
  )
    return result(
      1,
      "stale",
      "PR head or target branch changed. Rerun against the current revision.",
    );
  const label = current.labels.includes("quality-exception");
  const rationale = extractRationale(current.body);
  if (label && !rationale)
    return result(
      1,
      "invalid-exception",
      "Supply a reason under ## Quality exception or remove quality-exception.",
    );
  if (report.strictExitCode === 0)
    return result(
      0,
      "clean",
      label
        ? "Clean. The exception is currently unnecessary."
        : "No new quality regressions.",
      rationale,
    );
  if (label)
    return result(
      0,
      "exception",
      "Accepted PR-wide exception. Current findings remain visible.",
      rationale,
    );
  return result(
    1,
    "regression",
    "New quality regressions must be fixed or explicitly exempted.",
  );
}
