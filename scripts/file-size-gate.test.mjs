import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classify, physicalLines } from "./file-size-gate.mjs";
import {
  assertRatchetJson,
  commit,
  runGate,
  withRepo,
  write,
} from "./ratchet-test-helpers.mjs";

const GATE = fileURLToPath(new URL("./file-size-gate.mjs", import.meta.url));
const run = (dir, ...extra) => runGate(GATE, dir, ["--base", "main", ...extra]);
const lines = (n) =>
  Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") +
  "\n";

test("physicalLines counts like loominist", () => {
  assert.equal(physicalLines(""), 0);
  assert.equal(physicalLines("a"), 1);
  assert.equal(physicalLines("a\n"), 1);
  assert.equal(physicalLines("a\r\nb\r\n"), 2);
  assert.equal(physicalLines("a\nb"), 2);
});

test("classify: under cap passes, new at cap is NEW, grown is GREW, shrunk passes", () => {
  assert.equal(classify("f.ts", 999, null, 1000), null);
  assert.equal(classify("f.ts", 1000, null, 1000).verdict, "NEW");
  assert.equal(classify("f.ts", 1001, 1000, 1000).verdict, "GREW");
  assert.equal(classify("f.ts", 1000, 1000, 1000), null);
  assert.equal(classify("f.ts", 1200, 1300, 1000), null);
});

test(
  "clean diff exits 0",
  withRepo((dir) => {
    write(dir, "src/a.ts", lines(10));
    commit(dir, "base");
    write(dir, "src/a.ts", lines(12));
    const { code, stdout } = run(dir);
    assert.equal(code, 0, stdout);
  }),
);

test(
  "new file at the cap exits 1 with NEW",
  withRepo((dir) => {
    write(dir, "src/a.ts", lines(10));
    commit(dir, "base");
    write(dir, "src/big.ts", lines(1000));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /NEW\s+src\/big\.ts\s+1000 lines/);
  }),
);

test(
  "legacy file over the cap that shrank exits 0",
  withRepo((dir) => {
    write(dir, "src/big.ts", lines(1200));
    commit(dir, "base");
    write(dir, "src/big.ts", lines(1150));
    const { code, stdout } = run(dir);
    assert.equal(code, 0, stdout);
  }),
);

test(
  "legacy file over the cap that grew exits 1 with GREW and base count",
  withRepo((dir) => {
    write(dir, "src/big.ts", lines(1200));
    commit(dir, "base");
    write(dir, "src/big.ts", lines(1201));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /GREW\s+src\/big\.ts\s+1201 lines \(base 1200\)/);
  }),
);

test(
  "renamed legacy file keeps its base count",
  withRepo((dir) => {
    write(dir, "src/big.ts", lines(1200));
    commit(dir, "base");
    write(dir, "src/moved.ts", lines(1200));
    rmSync(join(dir, "src/big.ts"));
    // A committed rename is what CI sees; stage it so git pairs the paths.
    commit(dir, "rename");
    const { code, stdout } = runGate(GATE, dir, ["--base", "main~1"]);
    assert.equal(code, 0, stdout);
  }),
);

test(
  "unknown base ref and bad flags exit 2, never 0",
  withRepo((dir) => {
    write(dir, "src/a.ts", lines(10));
    commit(dir, "base");
    assert.equal(runGate(GATE, dir, ["--base", "nope"]).code, 2);
    assert.equal(runGate(GATE, dir, ["--bogus"]).code, 2);
    assert.equal(runGate(GATE, dir, ["--base"]).code, 2);
    assert.equal(runGate(GATE, dir, ["--base", ""]).code, 2);
  }),
);

test(
  "--help exits 0 and --repo points at another checkout",
  withRepo((dir) => {
    write(dir, "src/a.ts", lines(10));
    commit(dir, "base");
    write(dir, "src/big.ts", lines(1000));
    assert.equal(runGate(GATE, process.cwd(), ["--help"]).code, 0);
    assert.equal(
      runGate(GATE, process.cwd(), ["--base", "main", "--repo", dir]).code,
      1,
    );
  }),
);

test(
  "test fixtures and module variants are authored, declarations are generated",
  withRepo((dir) => {
    write(dir, "src/base.ts", "export const base = 1;");
    commit(dir, "base");
    for (const file of [
      "src/a.mts",
      "src/b.cts",
      "test/a.test.ts",
      "src/a.stories.ts",
      "src/api.d.mts",
      "src/api.d.cts",
      "generated/a.ts",
    ])
      write(dir, file, lines(1000));
    const result = run(dir, "--json");
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).findings.length, 4);
  }),
);
