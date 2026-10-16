import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { candidates, joinMessages, verdicts } from "./complexity-gate.mjs";
import { SetupError } from "./quality-git.mjs";
import {
  commit,
  git,
  runGate,
  withRepo,
  write,
} from "./ratchet-test-helpers.mjs";

const GATE = fileURLToPath(new URL("./complexity-gate.mjs", import.meta.url));
const run = (dir, ...extra) => runGate(GATE, dir, ["--base", "main", ...extra]);

/** A function with cyclomatic n+1 and cognitive n: n sibling ifs. */
const heavy = (name, n, tail = "return 0;") =>
  `export function ${name}(x: number) {\n` +
  Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i};\n`).join(
    "",
  ) +
  `  ${tail}\n}\n`;

/** A class accessor with cyclomatic n+1 and cognitive n. */
const accessor = (kind, n) =>
  `  ${kind} x(${kind === "set" ? "v: number" : ""}) {\n` +
  Array.from(
    { length: n },
    (_, i) => `    if (this.n === ${i}) return;\n`,
  ).join("") +
  `  }\n`;

const svc = (getN, setN) =>
  `export class Svc {\n  n = 0;\n${accessor("get", getN)}${accessor("set", setN)}}\n`;

/** A `handler` property with cyclomatic n+1, for an object literal. */
const handlerBody = (n) =>
  `  handler: (x: number) => {\n` +
  Array.from(
    { length: n },
    (_, i) => `    if (x === ${i}) return ${i};\n`,
  ).join("") +
  `    return 0;\n  },\n`;

/** That handler in an object literal a variable holds, so it has an owner. */
const withHandler = (name, n) =>
  `export const ${name} = {\n${handlerBody(n)}};\n`;

/** The same handler in an object literal nothing holds, so it has no owner. */
const anonHandler = (n) => `register({\n${handlerBody(n)}});\n`;

test("joinMessages attaches values to the innermost containing function", () => {
  const records = [
    {
      key: "outer",
      start: { line: 1, column: 0 },
      end: { line: 5, column: 1 },
    },
    {
      key: "outer#1",
      start: { line: 2, column: 10 },
      end: { line: 4, column: 3 },
    },
  ];
  const messages = [
    {
      ruleId: "complexity",
      line: 1,
      column: 1,
      message: "Function 'outer' has a complexity of 3. Maximum allowed is 0.",
    },
    {
      ruleId: "complexity",
      line: 2,
      column: 11,
      message: "Arrow function has a complexity of 2. Maximum allowed is 0.",
    },
    {
      ruleId: "sonarjs/cognitive-complexity",
      line: 2,
      column: 15,
      message:
        "Refactor this function to reduce its Cognitive Complexity from 4 to the 0 allowed.",
    },
  ];
  const fns = joinMessages(records, messages);
  assert.deepEqual(
    fns.map((f) => [f.key, f.cyclomatic, f.cognitive]),
    [
      ["outer", 3, 0],
      ["outer#1", 2, 4],
    ],
  );
});

test("joinMessages refuses a complexity message whose value it cannot read", () => {
  const records = [
    {
      key: "outer",
      start: { line: 1, column: 0 },
      end: { line: 5, column: 1 },
    },
  ];
  const messages = [
    {
      ruleId: "complexity",
      line: 1,
      column: 1,
      message: "Function 'outer' is too branchy (3). Maximum allowed is 0.",
    },
  ];
  assert.throws(() => joinMessages(records, messages, "src/a.ts"), SetupError);
  assert.throws(
    () => joinMessages(records, messages, "src/a.ts"),
    /src\/a\.ts: unrecognised complexity message/,
  );
});

test("joinMessages suffixes keys that repeat inside one file", () => {
  const records = [
    {
      key: "handler",
      start: { line: 1, column: 0 },
      end: { line: 2, column: 1 },
    },
    {
      key: "handler",
      start: { line: 3, column: 0 },
      end: { line: 4, column: 1 },
    },
    {
      key: "other",
      start: { line: 5, column: 0 },
      end: { line: 6, column: 1 },
    },
    {
      key: "handler",
      start: { line: 7, column: 0 },
      end: { line: 8, column: 1 },
    },
  ];
  assert.deepEqual(
    joinMessages(records, []).map((f) => f.key),
    ["handler", "handler~2", "other", "handler~3"],
  );
});

test("candidates keeps only over-threshold functions overlapping the diff", () => {
  const fns = [
    { key: "a", start: 1, end: 10, cyclomatic: 16, cognitive: 2 },
    { key: "b", start: 20, end: 30, cyclomatic: 16, cognitive: 2 },
    { key: "c", start: 40, end: 50, cyclomatic: 15, cognitive: 15 },
    { key: "d", start: 60, end: 70, cyclomatic: 1, cognitive: 16 },
  ];
  const ranges = [
    [5, 5],
    [45, 45],
    [65, 65],
  ];
  assert.deepEqual(
    candidates(fns, ranges, 15).map((f) => f.key),
    ["a", "d"],
  );
});

test("verdicts: absent at base is NEW, higher is GREW, equal or lower passes", () => {
  const cands = [
    { key: "a", cyclomatic: 20, cognitive: 3 },
    { key: "b", cyclomatic: 20, cognitive: 3 },
    { key: "c", cyclomatic: 20, cognitive: 3 },
    { key: "d", cyclomatic: 20, cognitive: 4 },
  ];
  const base = [
    { key: "b", cyclomatic: 20, cognitive: 3 },
    { key: "c", cyclomatic: 25, cognitive: 9 },
    { key: "d", cyclomatic: 20, cognitive: 3 },
  ];
  assert.deepEqual(
    verdicts(cands, base).map((f) => [f.key, f.verdict, f.baseCyclomatic]),
    [
      ["a", "NEW", null],
      ["d", "GREW", 20],
    ],
  );
  assert.deepEqual(
    verdicts(cands, null).map((f) => f.verdict),
    ["NEW", "NEW", "NEW", "NEW"],
  );
});

test(
  "clean diff exits 0 and names the base",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    write(dir, "src/a.ts", heavy("small", 4));
    const { code, stdout } = run(dir);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /clean/);
  }),
);

test(
  "new function over 15 exits 1 with NEW and both values",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    write(dir, "src/a.ts", heavy("small", 3) + heavy("big", 16));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(
      stdout,
      /NEW\s+big\s+L\d+-L\d+\s+cyclomatic 17\s+cognitive 16/,
    );
  }),
);

test(
  "exactly 15 passes",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    write(dir, "src/a.ts", heavy("edge", 14));
    const { code, stdout } = run(dir);
    assert.equal(code, 0, stdout);
  }),
);

test(
  "legacy function over 15 edited without growing exits 0",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("legacy", 20));
    commit(dir, "base");
    write(dir, "src/a.ts", heavy("legacy", 20, "return 99;"));
    const { code, stdout } = run(dir);
    assert.equal(code, 0, stdout);
  }),
);

test(
  "legacy function that grew exits 1 with GREW and base values",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("legacy", 20));
    commit(dir, "base");
    write(dir, "src/a.ts", heavy("legacy", 21));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(
      stdout,
      /GREW\s+legacy\s+L\d+-L\d+\s+cyclomatic 22 \(base 21\)\s+cognitive 21 \(base 20\)/,
    );
  }),
);

test(
  "renamed legacy function reads as NEW",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("legacy", 20));
    commit(dir, "base");
    write(dir, "src/a.ts", heavy("renamed", 20));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /NEW\s+renamed/);
  }),
);

test(
  "untracked tsx file with a heavy component exits 1; JSX parses",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    const branches = Array.from(
      { length: 16 },
      (_, i) => `{p.n === ${i} && <b>${i}</b>}`,
    ).join("\n");
    write(
      dir,
      "src/Page.tsx",
      `export function Page(p: { n: number }) {\n  return (<div>\n${branches}\n</div>);\n}\n`,
    );
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /src\/Page\.tsx/);
    assert.match(stdout, /NEW\s+Page/);
  }),
);

test(
  "anonymous callbacks are keyed by nearest named ancestor and ordinal",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    const inner = Array.from(
      { length: 16 },
      (_, i) => `    if (y === ${i}) return ${i};\n`,
    ).join("");
    write(
      dir,
      "src/a.ts",
      `export function outer(xs: number[]) {\n  xs.map(() => 1);\n  return xs.map((y) => {\n${inner}    return 0;\n  });\n}\n`,
    );
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /NEW\s+outer#2\s/);
  }),
);

test(
  "class methods are keyed Class.method",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    const body = Array.from(
      { length: 16 },
      (_, i) => `    if (x === ${i}) return ${i};\n`,
    ).join("");
    write(
      dir,
      "src/a.ts",
      `export class Svc {\n  run(x: number) {\n${body}    return 0;\n  }\n}\n`,
    );
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /NEW\s+Svc\.run\s/);
  }),
);

test(
  "a getter is not measured against its own setter",
  withRepo((dir) => {
    write(dir, "src/a.ts", svc(9, 29));
    commit(dir, "base");
    write(dir, "src/a.ts", svc(19, 29));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /GREW\s+Svc\.get x\s/);
  }),
);

test(
  "same-named handlers with no owner are keyed by occurrence",
  withRepo((dir) => {
    write(dir, "src/a.ts", anonHandler(3) + anonHandler(3));
    commit(dir, "base");
    write(dir, "src/a.ts", anonHandler(3) + anonHandler(16));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /GREW\s+handler~2\s/);
  }),
);

test(
  "an object-literal handler is keyed by the variable that holds it",
  withRepo((dir) => {
    write(dir, "src/a.ts", withHandler("listA", 30) + withHandler("listB", 17));
    commit(dir, "base");
    // listA is gone and listB's handler grew. A bare positional key would
    // have measured the grown handler against the deleted heavier sibling.
    write(dir, "src/a.ts", withHandler("listB", 20));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(
      stdout,
      /GREW\s+listB\.handler\s+L\d+-L\d+\s+cyclomatic 21 \(base 18\)/,
    );
  }),
);

test(
  "a Convex-shaped handler is keyed by the name the call is assigned to",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    const src = `export const createListing = mutation({\n  args: {},\n${handlerBody(16)}});\n`;
    write(dir, "src/a.ts", src);
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /NEW\s+createListing\.handler\s/);
  }),
);

test(
  "an inline eslint-disable does not mute the gate",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    write(dir, "src/a.ts", `/* eslint-disable */\n` + heavy("big", 16));
    const { code, stdout } = run(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /NEW\s+big\s/);
  }),
);

test(
  "a renamed file reads its base from the old path",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("legacy", 20));
    commit(dir, "base");
    git(dir, "mv", "src/a.ts", "src/b.ts");
    commit(dir, "rename");
    const { code, stdout } = runGate(GATE, dir, ["--base", "main~1"]);
    assert.equal(code, 0, stdout);
  }),
);

test(
  "a syntax error in a touched file exits 2, never 0",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    write(dir, "src/a.ts", "export function (\n");
    const { code, stderr } = run(dir);
    assert.equal(code, 2, stderr);
    assert.match(stderr, /Parsing error/);
  }),
);

test(
  "dependency folders stay excluded even when untracked",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    // ESLint's flat config ignores node_modules by default. The negation
    // keeps git from ignoring the file, so it still shows up in the diff.
    write(dir, ".gitignore", "!node_modules/\n");
    write(dir, "node_modules/pkg/index.ts", heavy("big", 16));
    const { code, stdout } = run(dir, "--json");
    assert.equal(code, 0, stdout);
    assert.equal(JSON.parse(stdout).scanned, 0);
  }),
);

test(
  "unknown base ref and bad flags exit 2; --help exits 0",
  withRepo((dir) => {
    write(dir, "src/a.ts", heavy("small", 3));
    commit(dir, "base");
    assert.equal(runGate(GATE, dir, ["--base", "nope"]).code, 2);
    assert.equal(runGate(GATE, dir, ["--bogus"]).code, 2);
    assert.equal(runGate(GATE, dir, ["--help"]).code, 0);
  }),
);

test(
  "module variants and stories are checked with no inline bypass",
  withRepo((dir) => {
    write(dir, "src/base.ts", "export const base = 1;");
    commit(dir, "base");
    for (const ext of ["mts", "cts", "cjs"]) {
      const code = heavy("work", 16).replace("export ", "");
      write(
        dir,
        "src/work." + ext,
        ext === "mts"
          ? code
          : "if (false) return;\n" +
              (ext === "cjs" ? code.replace(": number", "") : code),
      );
    }
    write(
      dir,
      "src/work.stories.ts",
      "/* eslint-disable */\n" + heavy("story", 16),
    );
    const result = run(dir, "--json");
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).findings.length, 4);
  }),
);
