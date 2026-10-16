import { symlinkSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tempRepo, write, commit, git } from "./ratchet-test-helpers.mjs";
import { changedRanges, isRepoSourcePath } from "./quality-git.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  isSourcePath,
  parseDiffPath,
  parseRenameStatus,
  parseUnifiedDiff,
  isTestPath,
  touchesDiff,
} from "./quality-git.mjs";
test("test path policy includes fixture modules used only by tests", () => {
  assert.equal(isTestPath("convex/tests/billing.test.ts"), true);
  assert.equal(isTestPath("apps/web/lib/testBillingFixtures.ts"), true);
  assert.equal(isTestPath("apps/web/test/fixtures/guild.ts"), true);
  assert.equal(isTestPath("convex/convex/billing.ts"), false);
});

test("parseDiffPath handles every shape git emits", () => {
  assert.equal(parseDiffPath("b/src/a.js"), "src/a.js");
  // Trailing TAB when the path contains spaces. Missing this made the map key
  // unreachable, so duplication in such files was never reported.
  assert.equal(parseDiffPath("b/with space.js\t"), "with space.js");
  // C-quoted when the path has a quote or backslash.
  assert.equal(parseDiffPath('"b/wei\\"rd.js"'), 'wei"rd.js');
  assert.equal(
    parseDiffPath('"b/a\\a\\b\\v\\f\\001b.js"'),
    `a\x07\b\v\f\x01b.js`,
    "Git control and octal escapes are decoded",
  );
  assert.equal(
    parseDiffPath('"b/caf\\303\\251.js"'),
    "café.js",
    "octal UTF-8 bytes are decoded",
  );
  assert.equal(
    parseDiffPath('"b/a\\qb.js"'),
    "a\\qb.js",
    "unknown escapes retain the slash",
  );
  assert.equal(parseDiffPath("/dev/null"), null);
});

test("parseUnifiedDiff does not leak one file's hunks onto another", () => {
  // Regression: an unparsed `+++` line used to leave `file` pointing at the
  // PREVIOUS file, so the next hunks were attributed to it. That fabricated
  // findings against untouched code.
  const diff = [
    "diff --git a/aaa.js b/aaa.js",
    "--- a/aaa.js",
    "+++ b/aaa.js",
    "@@ -34,0 +34,1 @@",
    "+// touched",
    "diff --git a/café.js b/café.js",
    "--- /dev/null",
    "+++ b/café.js",
    "@@ -0,0 +1,20 @@",
    "+x",
  ].join("\n");
  const m = parseUnifiedDiff(diff);
  assert.deepEqual(m.get("aaa.js"), [[34, 34]]);
  assert.deepEqual(m.get("café.js"), [[1, 20]]);
  assert.equal(
    touchesDiff(m, "aaa.js", 2, 13),
    false,
    "untouched clone must not be flagged",
  );
});

test("parseUnifiedDiff handles new files, +0,0, and CRLF", () => {
  const m = parseUnifiedDiff(
    [
      "diff --git a/new.js b/new.js",
      "--- /dev/null\r",
      "+++ b/new.js\r",
      "@@ -0,0 +1,3 @@",
      "+a",
      "diff --git a/del.js b/del.js",
      "--- a/del.js",
      "+++ b/del.js",
      "@@ -5,2 +4,0 @@",
      "-gone",
    ].join("\n"),
  );
  assert.deepEqual(m.get("new.js"), [[1, 3]]);
  assert.deepEqual(
    m.get("del.js"),
    [[3, 4]],
    "+0,0 marks the surviving deletion boundary",
  );
});

test("parseUnifiedDiff cannot be fooled by diff syntax inside diff content", () => {
  // Content lines only ever appear inside a hunk, so nothing that looks like a
  // header can be read as one there. Two variants, both from docs that discuss
  // diff syntax:
  //   a) an added line beginning "++ " renders as "+++ "
  //   b) a removed "-- a/X" and an added "++ b/X" render as an adjacent
  //      "--- a/X" / "+++ b/X" pair, which passes a prev-line-only check
  const m = parseUnifiedDiff(
    [
      "diff --git a/docs/guide.md b/docs/guide.md",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -1,0 +2,3 @@",
      "+++ b/evil/spoof.js",
      "++ not a header",
      "+text",
      "@@ -50,1 +60,5 @@",
      "--- a/evil/adjacent.js",
      "+++ b/evil/adjacent.js",
      "+more",
    ].join("\n"),
  );
  assert.deepEqual(m.get("docs/guide.md"), [
    [2, 4],
    [60, 64],
  ]);
  assert.equal(
    m.has("evil/spoof.js"),
    false,
    "content line must not create a file",
  );
  assert.equal(
    m.has("evil/adjacent.js"),
    false,
    "adjacent ---/+++ content must not create a file",
  );
});

test("parseRenameStatus reads NUL-delimited rename records", () => {
  assert.deepEqual(
    parseRenameStatus("R100\0src/helper.test.ts\0src/helper.ts\0"),
    [{ oldPath: "src/helper.test.ts", newPath: "src/helper.ts" }],
  );
});

test("source eligibility includes modules and tests but excludes output", () => {
  for (const p of [
    "vite.config.mts",
    "src/run.cts",
    "test/a.test.ts",
    "src/A.stories.tsx",
  ])
    assert.equal(isSourcePath(p), true, p);
  for (const p of [
    "src/api.d.ts",
    "src/api.d.mts",
    "src/api.d.cts",
    "apps/desktop/src-tauri/gen/a.ts",
    ".worktrees/other/src/a.ts",
    "node_modules/pkg/index.js",
    "build/app.js",
  ])
    assert.equal(isSourcePath(p), false, p);
});

test("an external directory junction is excluded without changing the index", () => {
  const dir = tempRepo();
  const external = mkdtempSync(join(tmpdir(), "quality-external-"));
  try {
    write(dir, "src/base.ts", "export const seed = 1;");
    commit(dir, "base");
    write(external, "copy.ts", "export const copy = 1;");
    symlinkSync(external, join(dir, "linked"), "junction");
    const before = git(dir, "write-tree");
    assert.equal(isRepoSourcePath(dir, "linked/copy.ts"), false);
    assert.equal(changedRanges(dir, "HEAD").has("linked/copy.ts"), false);
    assert.equal(git(dir, "write-tree"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
