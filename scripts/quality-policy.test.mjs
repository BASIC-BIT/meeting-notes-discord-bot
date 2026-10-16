import test from "node:test";
import assert from "node:assert/strict";
import { extractRationale, evaluatePolicy } from "./quality-policy.mjs";
import { qualityReport, qualityInput } from "./ratchet-test-helpers.mjs";

test("the PR-wide decision table never exempts operational failures", () => {
  for (const [codes, label, reason, outcome, exitCode] of [
    [[0, 0, 0], false, false, "clean", 0],
    [[0, 0, 0], true, true, "clean", 0],
    [[1, 0, 1], true, true, "exception", 0],
    [[1, 0, 0], false, false, "regression", 1],
    [[1, 0, 0], true, false, "invalid-exception", 1],
    [[0, 0, 0], true, false, "invalid-exception", 1],
    [[1, 2, 0], true, true, "error", 2],
  ]) {
    const input = qualityInput(codes);
    input.current.labels = label ? ["quality-exception"] : [];
    input.current.body = reason
      ? "## Quality exception\nA deliberate implementation boundary."
      : "";
    const result = evaluatePolicy(input);
    assert.equal(result.outcome, outcome);
    assert.equal(result.exitCode, exitCode);
  }
});
test("an incomplete report or failed checker test cannot be exempted", () => {
  const input = qualityInput([1, 0, 0]);
  assert.equal(
    evaluatePolicy({ ...input, checkerTestsPassed: false }).exitCode,
    2,
  );
  assert.equal(
    evaluatePolicy({ ...input, report: { ...input.report, scanners: [] } })
      .exitCode,
    2,
  );
  assert.equal(evaluatePolicy({ ...input, current: null }).exitCode, 2);
});
test("an exception persists across pushes but uses the current head", () => {
  const input = qualityInput([1, 0, 0]);
  assert.equal(evaluatePolicy(input).outcome, "exception");
  const next = {
    ...input,
    scanned: { ...input.scanned, headSha: "next" },
    current: { ...input.current, headSha: "next" },
  };
  assert.equal(evaluatePolicy(next).outcome, "exception");
  assert.equal(
    evaluatePolicy({ ...next, current: { ...next.current, labels: [] } })
      .outcome,
    "regression",
  );
  for (const change of [
    { headSha: "different" },
    { baseRef: "other" },
    { baseSha: "advanced" },
  ])
    assert.equal(
      evaluatePolicy({ ...input, current: { ...input.current, ...change } })
        .outcome,
      "stale",
    );
  const inconsistent = qualityReport();
  inconsistent.scanners.forEach((s) => (s.report.mergeBase = "not-scanned"));
  assert.equal(evaluatePolicy({ ...input, report: inconsistent }).exitCode, 2);
});
test("only a real exact heading with non-comment content supplies a rationale", () => {
  assert.equal(
    extractRationale("## Quality exception\n<!-- Explain the exception -->"),
    null,
  );
  assert.equal(extractRationale("## Quality exception\n<!-- unfinished"), null);
  assert.equal(
    extractRationale("~~~md\n## Quality exception\nexample\n~~~"),
    null,
  );
  assert.equal(
    extractRationale("## Quality exception\n\n## Summary\nOther text."),
    null,
  );
  assert.equal(extractRationale("## quality exception\nWrong case."), null);
  assert.equal(
    extractRationale(
      "## Quality exception\r\nReason.\r\n### Detail\r\nMore.\r\n## Next\r\nOutside.",
    ),
    "Reason.\n### Detail\nMore.",
  );
  const literal = "$(echo should-never-run); `literal`";
  assert.equal(extractRationale("## Quality exception\n" + literal), literal);
});
