import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  parseScannerResult,
  validateQualityReport,
  runQuality,
} from "./check-quality.mjs";
import {
  withRepo,
  write,
  commit,
  body,
  runGate,
  qualityReport,
} from "./ratchet-test-helpers.mjs";

test("child reports validate outcomes rather than trusting exit codes", () => {
  const valid = qualityReport().scanners[0].report;
  const child = (report, status = 0) => ({
    status,
    signal: null,
    stdout: JSON.stringify(report),
    stderr: "",
  });
  assert.equal(parseScannerResult("duplication", child(valid)).exitCode, 0);
  for (const raw of [
    { ...child(valid), status: null, signal: "SIGTERM" },
    { ...child(valid), status: 7 },
    { ...child(valid), stdout: "{" },
    child({ ...valid, scanned: -1 }),
    child({ ...valid, findings: [{}] }),
    child({ ...valid, findings: [] }, 1),
    child({ ...valid, mergeBase: "" }),
  ])
    assert.equal(parseScannerResult("duplication", raw).exitCode, 2);
  assert.equal(
    parseScannerResult("duplication", child({ ...valid, findings: [{}] }, 1))
      .exitCode,
    1,
  );
});
test("report validation rejects missing, duplicate, or contradictory scanner sets", () => {
  const valid = qualityReport();
  assert.doesNotThrow(() => validateQualityReport(valid));
  const duplicate = {
    ...valid,
    scanners: [valid.scanners[0], valid.scanners[0], valid.scanners[2]],
  };
  for (const report of [
    { ...valid, schemaVersion: 9 },
    { ...valid, scanners: [] },
    duplicate,
    { ...valid, strictExitCode: 1 },
    {
      ...valid,
      scanners: valid.scanners.map((s, i) =>
        i === 1 ? { ...s, report: { ...s.report, mergeBase: "other" } } : s,
      ),
    },
  ])
    assert.throws(() => validateQualityReport(report));
});
test(
  "the real runner retains findings from all three scanners",
  withRepo(async (dir) => {
    write(dir, "src/original.js", body("alpha"));
    commit(dir, "base");
    write(dir, "src/copy.js", body("beta"));
    write(
      dir,
      "src/big.ts",
      Array.from(
        { length: 1000 },
        (_, i) => "export const v" + i + " = " + i + ";",
      ).join("\n"),
    );
    write(
      dir,
      "src/heavy.ts",
      "export function heavy(x:number){\n" +
        Array.from(
          { length: 16 },
          (_, i) => "if(x===" + i + ")return " + i + ";",
        ).join("\n") +
        "\nreturn 0;}",
    );
    const report = await runQuality({ repo: dir, base: "HEAD" });
    assert.equal(report.strictExitCode, 1);
    assert.deepEqual(
      report.scanners.map((s) => s.exitCode),
      [1, 1, 1],
    );
    assert.ok(report.scanners.every((s) => s.report.findings.length > 0));
  }),
);
test(
  "a missing baseline returns complete operational results from the CLI",
  withRepo((dir) => {
    write(dir, "src/seed.ts", "export const seed=1;");
    commit(dir, "base");
    const cli = fileURLToPath(new URL("./check-quality.mjs", import.meta.url));
    const result = runGate(cli, dir, ["--base", "missing", "--json"]);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).scanners.length, 3);
  }),
);
