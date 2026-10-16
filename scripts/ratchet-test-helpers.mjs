// Fixture helpers shared by the ratchet test suites. Kept out of the suites
// so dup-gate does not see the same helper twice.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const git = (dir, ...args) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

export function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

export function write(dir, rel, text) {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function commit(dir, msg) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

export const withRepo = (fn) => async () => {
  const dir = tempRepo();
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Spawn a gate as a real process so exit codes are tested, not inferred. */
export function runGate(gate, dir, args) {
  const r = spawnSync(process.execPath, [gate, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * The `--json` envelope both gates emit. Asserts the top-level shape and hands
 * the parsed object back so each suite can check its own findings.
 */
export function assertRatchetJson(result) {
  const out = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(out), [
    "base",
    "mergeBase",
    "changedFiles",
    "scanned",
    "findings",
  ]);
  return out;
}

/** A 12-line body that clears the 8-line / 50-token floor. */
export const body = (tag) => `
export function ${tag}(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", value: null };
  }
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, reason: "no-parts", value: null };
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  return { ok: true, reason: null, value: total, parts, count: parts.length };
}
`;

export const replacementBody = (tag) => `
export function ${tag}(input) {
  const values = Array.isArray(input) ? input : [input];
  const cleaned = values.map((value) => String(value ?? "").trim());
  const present = cleaned.filter((value) => value.length > 0);
  const lengths = present.map((value) => value.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const longest = lengths.reduce((max, length) => Math.max(max, length), 0);
  const average = present.length === 0 ? 0 : total / present.length;
  const summary = { total, longest, average, count: present.length };
  return { ok: present.length > 0, values: present, summary };
}
`;

export const inlineBoundaryBody = (tag, note) => `
export function ${tag}(input) { const ${tag}Only = "${note}"; const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", value: null };
  }
  const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, reason: "no-parts", value: null };
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const count = parts.length;
  return { ok: true, reason: null, value: total, parts, count };
}
`;

export const divisionArrayBody = (tag, note) => `
export function ${tag}(input) {
  const ${tag}Operand = String(input ?? "").length;
  const ratio = ${tag}Operand
    / [1, // ${note}
      2,
      3,
      4,
      5,
      6,
      7,
      8,
    ].reduce((sum, value) => sum + value, 0);
  const rounded = Math.round(ratio * 100) / 100;
  const status = Number.isFinite(rounded) ? "finite" : "invalid";
  const summary = { ratio, rounded, status };
  return { ok: status === "finite", summary };
}
`;

export function qualityReport(codes = [0, 0, 0]) {
  const names = ["duplication", "complexity", "file-size"];
  return {
    schemaVersion: 1,
    scanners: names.map((name, i) => ({
      name,
      exitCode: codes[i],
      report:
        codes[i] === 2
          ? null
          : {
              base: "b",
              mergeBase: "b",
              changedFiles: 1,
              scanned: 1,
              findings: codes[i] === 1 ? [qualityFinding(name)] : [],
            },
      error: codes[i] === 2 ? "scanner unavailable" : null,
    })),
    strictExitCode: Math.max(...codes),
  };
}
export function qualityInput(codes = [0, 0, 0]) {
  const scanned = {
    headSha: "a",
    baseRef: "master",
    baseSha: "b",
    treeSha: "t",
  };
  return {
    report: qualityReport(codes),
    scanned,
    current: {
      ...scanned,
      labels: ["quality-exception"],
      body: "## Quality exception\nReviewed boundary.",
    },
    checkerTestsPassed: true,
  };
}

function qualityFinding(name) {
  if (name === "duplication")
    return {
      a: "src/a.ts",
      b: "src/b.ts",
      as: 1,
      ae: 12,
      bs: 1,
      be: 12,
      lines: 12,
      tokens: 60,
      verdict: "duplicates-existing",
    };
  if (name === "complexity")
    return {
      file: "src/a.ts",
      key: "heavy",
      start: 1,
      end: 20,
      cyclomatic: 17,
      cognitive: 16,
      baseCyclomatic: null,
      baseCognitive: null,
      verdict: "NEW",
    };
  return { file: "src/a.ts", lines: 1001, baseLines: 1000, verdict: "GREW" };
}
