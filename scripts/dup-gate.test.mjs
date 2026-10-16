import test from "node:test";
import assert from "node:assert/strict";

import {
  classify,
  dedupe,
  filterPreExisting,
  fingerprintCloneSource,
  normalizedCloneContains,
  sliceScannerSource,
  wasFindingPresentAtBase,
} from "./dup-gate.mjs";

test("sliceScannerSource honors exact zero-based scanner columns", () => {
  const source = "prefix cloned start\ncloned middle\ncloned end suffix";
  assert.equal(
    sliceScannerSource(source, {
      start: 1,
      end: 3,
      startLoc: { line: 1, column: 7 },
      endLoc: { line: 3, column: 10 },
    }),
    "cloned start\ncloned middle\ncloned end",
  );
  assert.equal(
    sliceScannerSource("prefix cloned suffix", {
      start: 1,
      end: 1,
      startLoc: { line: 1, column: 7 },
      endLoc: { line: 1, column: 13 },
    }),
    "cloned",
  );
  assert.equal(
    sliceScannerSource(
      "prefix cloned start\r\ncloned middle\r\ncloned end suffix",
      {
        start: 1,
        end: 3,
        startLoc: { line: 1, column: 7 },
        endLoc: { line: 3, column: 10 },
      },
    ),
    "cloned start\r\ncloned middle\r\ncloned end",
    "scanner slices preserve original CRLF bytes inside literal tokens",
  );
});

test("classify keeps same-file duplication but rejects self-matches", () => {
  const ranges = new Map([["x.ts", [[1, 200]]]]);
  const opts = { minLines: 8, includeTests: false };
  const base = { kind: "token", a: "x.ts", b: "x.ts", lines: 20 };
  assert.equal(
    classify([{ ...base, as: 1, ae: 20, bs: 40, be: 60 }], ranges, opts).length,
    1,
  );
  assert.equal(
    classify([{ ...base, as: 1, ae: 20, bs: 10, be: 30 }], ranges, opts).length,
    0,
  );
});

test("classify ignores duplication the diff did not touch", () => {
  const opts = { minLines: 8, includeTests: false };
  const row = {
    kind: "token",
    a: "a.ts",
    as: 1,
    ae: 30,
    b: "b.ts",
    bs: 1,
    be: 30,
    lines: 30,
  };
  assert.equal(classify([row], new Map([["c.ts", [[1, 99]]]]), opts).length, 0);
  assert.equal(
    classify([row], new Map([["b.ts", [[10, 12]]]]), opts)[0].verdict,
    "duplicates-existing",
  );
  assert.equal(
    classify(
      [row],
      new Map([
        ["a.ts", [[1, 5]]],
        ["b.ts", [[1, 5]]],
      ]),
      opts,
    )[0].verdict,
    "added-twice",
  );
});

test("classify reports a touched original plus a new copy as duplicates-existing", () => {
  const ranges = new Map([
    ["new.ts", [[10, 21]]],
    ["original.ts", [[10, 10]]],
  ]);
  ranges.hunks = new Map([
    ["new.ts", [{ oldStart: 10, oldCount: 0, newStart: 10, newCount: 12 }]],
    ["original.ts", [{ oldStart: 10, oldCount: 1, newStart: 10, newCount: 1 }]],
  ]);
  ranges.renames = new Map();
  ranges.renames.hunks = ranges.hunks;
  ranges.renames.newPaths = new Set();
  const [finding] = classify(
    [
      {
        kind: "token",
        a: "new.ts",
        as: 10,
        ae: 21,
        b: "original.ts",
        bs: 10,
        be: 21,
        lines: 12,
        tokens: 60,
      },
    ],
    ranges,
    { minLines: 8, includeTests: false },
  );
  assert.equal(finding.verdict, "duplicates-existing");
});

test("classify reports a replacement-only endpoint plus an inserted copy as added twice", () => {
  const ranges = new Map([
    ["src/a.ts", [[10, 20]]],
    ["src/b.ts", [[30, 40]]],
  ]);
  ranges.hunks = new Map([
    ["src/a.ts", [{ oldStart: 10, oldCount: 11, newStart: 10, newCount: 11 }]],
    ["src/b.ts", [{ oldStart: 30, oldCount: 0, newStart: 30, newCount: 11 }]],
  ]);
  const [finding] = classify(
    [
      {
        kind: "token",
        a: "src/a.ts",
        as: 10,
        ae: 20,
        b: "src/b.ts",
        bs: 30,
        be: 40,
        lines: 11,
        tokens: 55,
      },
    ],
    ranges,
    { includeTests: false, minLines: 8 },
  );
  assert.equal(finding.verdict, "added-twice");
});

test("dedupe collapses overlapping and reversed exact clone pairs", () => {
  const token = {
    kind: "token",
    a: "a.ts",
    as: 5,
    ae: 25,
    b: "b.ts",
    bs: 5,
    be: 25,
    lines: 20,
  };
  const overlapping = { ...token, as: 1, ae: 30, bs: 1, be: 30, lines: 30 };
  const out = dedupe([token, overlapping]);
  assert.equal(out.length, 1);
  // Reversed orientation is the same pair.
  assert.equal(dedupe([token, { ...token, a: "b.ts", b: "a.ts" }]).length, 1);
});

const tokenFinding = (overrides = {}) => ({
  kind: "token",
  a: "src/a.ts",
  as: 10,
  ae: 21,
  af: "stable-a",
  b: "src/b.ts",
  bs: 1,
  be: 12,
  bf: "stable-b",
  lines: 12,
  tokens: 60,
  ...overrides,
});

test("baseline matching translates endpoints across preceding deletions", () => {
  const current = tokenFinding();
  const baseline = { ...current, as: 40, ae: 51 };
  const changes = new Map();
  changes.hunks = new Map([
    ["src/a.ts", [{ oldStart: 10, oldCount: 30, newStart: 9, newCount: 0 }]],
  ]);
  assert.equal(wasFindingPresentAtBase(current, [baseline], changes), true);
});

test("baseline matching preserves preceding offsets across an ignored inner insertion", () => {
  const current = tokenFinding({ ae: 22 });
  const baseline = { ...current, as: 40, ae: 51 };
  const changes = new Map();
  changes.hunks = new Map([
    [
      "src/a.ts",
      [
        { oldStart: 10, oldCount: 30, newStart: 9, newCount: 0 },
        { oldStart: 45, oldCount: 0, newStart: 15, newCount: 1 },
      ],
    ],
  ]);
  assert.equal(wasFindingPresentAtBase(current, [baseline], changes), true);
});

test("a broad rename hunk does not make same-content occurrences interchangeable", () => {
  const current = tokenFinding({
    a: "src/renamed.ts",
    as: 31,
    ae: 42,
    af: "same-content",
  });
  const baseline = { ...current, a: "src/original.ts", as: 1, ae: 12 };
  const renames = new Map([["src/renamed.ts", "src/original.ts"]]);
  renames.hunks = new Map([
    [
      "src/renamed.ts",
      [{ oldStart: 1, oldCount: 60, newStart: 1, newCount: 60 }],
    ],
  ]);
  assert.equal(wasFindingPresentAtBase(current, [baseline], renames), false);
});

test("a stable-path insertion cannot impersonate an old occurrence at the same lines", () => {
  const current = {
    kind: "token",
    a: "src/a.ts",
    as: 10,
    ae: 21,
    af: "same-content",
    b: "src/b.ts",
    bs: 1,
    be: 12,
    bf: "stable-b",
    lines: 12,
    tokens: 60,
  };
  const baseline = { ...current };
  const changes = new Map();
  changes.hunks = new Map([
    ["src/a.ts", [{ oldStart: 10, oldCount: 0, newStart: 10, newCount: 12 }]],
  ]);
  assert.equal(wasFindingPresentAtBase(current, [baseline], changes), false);
});

test("a smaller token clone at merge base does not hide a newly enlarged clone", () => {
  const current = {
    kind: "token",
    a: "src/a.ts",
    as: 1,
    ae: 30,
    b: "src/b.ts",
    bs: 1,
    be: 30,
    lines: 30,
    tokens: 120,
    af: "current-alpha",
    bf: "stable-beta",
  };
  const baseline = {
    ...current,
    as: 1,
    ae: 12,
    bs: 1,
    be: 12,
    lines: 12,
    tokens: 55,
    af: "base-alpha",
  };

  assert.equal(wasFindingPresentAtBase(current, [baseline]), false);
  assert.equal(
    wasFindingPresentAtBase(current, [{ ...baseline, tokens: 120 }]),
    true,
  );
});

test("baseline matching requires one unchanged clone endpoint", () => {
  const current = {
    kind: "token",
    a: "src/a.ts",
    as: 1,
    ae: 20,
    af: "new-alpha",
    b: "src/b.ts",
    bs: 1,
    be: 20,
    bf: "new-beta",
    lines: 20,
    tokens: 80,
  };
  const baseline = { ...current, af: "old-alpha", bf: "old-beta" };
  assert.equal(wasFindingPresentAtBase(current, [baseline]), false);
  assert.equal(
    wasFindingPresentAtBase(current, [{ ...baseline, bf: "new-beta" }]),
    true,
  );
});

test("shortened baseline clones must start and end on token boundaries", () => {
  assert.equal(
    normalizedCloneContains("\0prefix\0value\0", "\0fix\0value\0"),
    false,
  );
  assert.equal(
    normalizedCloneContains("\0value??=fallback\0", "\0value??\0"),
    false,
  );
  assert.equal(normalizedCloneContains("\0obj->member\0", "\0obj-\0"), false);
  assert.equal(
    normalizedCloneContains("\0before\0fix+value\0after\0", "\0fix+value\0"),
    true,
  );
});

test("filterPreExisting keeps new findings and counts merge-base matches", () => {
  const existing = {
    kind: "token",
    a: "src/a.ts",
    as: 1,
    ae: 12,
    af: "stable-a",
    b: "src/b.ts",
    bs: 1,
    be: 12,
    bf: "stable-b",
    lines: 12,
    tokens: 60,
  };
  const introduced = { ...existing, a: "src/c.ts", af: "new-c" };
  const result = filterPreExisting([existing, introduced], [existing]);
  assert.equal(result.preExisting, 1);
  assert.deepEqual(result.findings, [introduced]);
});

test("fingerprints ignore comments while preserving literal contents", () => {
  assert.equal(
    fingerprintCloneSource('const value="alpha"; // first', "javascript"),
    fingerprintCloneSource('const value = "alpha"; // second', "javascript"),
  );
  assert.notEqual(
    fingerprintCloneSource('const value="alpha";', "javascript"),
    fingerprintCloneSource('const value="beta";', "javascript"),
  );
});
