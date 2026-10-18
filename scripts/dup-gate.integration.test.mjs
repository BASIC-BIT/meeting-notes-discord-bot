import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdirSync,
  renameSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  withRepo,
  write as writeFile,
  git,
  commit,
  body,
  replacementBody,
  inlineBoundaryBody,
  divisionArrayBody,
  runGate,
} from "./ratchet-test-helpers.mjs";
const GATE = join(dirname(fileURLToPath(import.meta.url)), "dup-gate.mjs");
const write = (dir, name, text) => writeFile(dir, "src/" + name, text);
const exec = (dir, args) => runGate(GATE, dir, args);
const run = (dir, ...args) => exec(dir, ["--base", "main~1", ...args]);
const maybe = test;
function seedExistingPair(dir) {
  write(dir, "a.js", body("alpha"));
  write(dir, "b.js", body("beta"));
  commit(dir, "base with existing duplication");
}
function assertFlags(dir, pattern, ...args) {
  const r = run(dir, ...args);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, pattern);
  return r.stdout;
}
function assertClean(dir, ...args) {
  const r = run(dir, ...args);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No duplication introduced/);
}
maybe(
  "clean diff passes",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "unrelated.js", "export const x = 1;\n");
    commit(dir, "add unrelated");
    assertClean(dir);
  }),
);

maybe(
  "new code duplicating pre-existing code fails as DUPLICATES EXISTING",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "b.js", body("beta"));
    commit(dir, "add duplicate");
    const out = assertFlags(dir, /DUPLICATES EXISTING/);
    assert.match(out, /src\/b\.js/);
  }),
);

maybe(
  "an inaugural gate checks changes committed before the gate was introduced",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base without gate");
    write(dir, "b.js", body("beta"));
    commit(dir, "add duplicate before gate");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(
      join(dir, "scripts", "dup-gate.mjs"),
      "// gate arrives later\n",
    );
    commit(dir, "introduce gate");

    const { code, stdout } = exec(dir, ["--base", "main~2"]);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /DUPLICATES EXISTING/);
    assert.match(stdout, /src\/b\.js/);
  }),
);

maybe(
  "duplication in a path containing a space is still detected",
  withRepo((dir) => {
    // Regression: git appends a TAB to `+++ b/<path>` when the path has spaces,
    // which used to corrupt the map key and silently pass.
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "b copy.js", body("beta"));
    commit(dir, "add duplicate with space in name");
    assertFlags(dir, /b copy\.js/);
  }),
);

maybe(
  "a relative --repo path still detects duplication",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "b.js", body("beta"));
    commit(dir, "add duplicate");
    const { code, stdout } = exec(dir, ["--base", "main~1", "--repo", "."]);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /DUPLICATES EXISTING/);
  }),
);

maybe(
  "uncommitted duplication is caught (the documented pre-commit workflow)",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "seed.js", "export const s = 1;\n");
    commit(dir, "second");
    // Never committed, and untracked. SKILL.md tells agents to run the gate
    // before committing, and `git diff` alone would not see this at all.
    write(dir, "b.js", body("beta"));
    assertFlags(dir, /src\/b\.js/);
  }),
);

maybe(
  "uncommitted edits do not desync ranges from committed findings",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "b.js", body("beta"));
    commit(dir, "add duplicate");
    // Shift the clone down 20 lines without committing. Ranges derived from
    // HEAD would no longer overlap what the scanner reads in the worktree.
    write(dir, "b.js", "// pad\n".repeat(20) + body("beta"));
    assertFlags(dir, /src\/b\.js/);
  }),
);

maybe(
  "a diff adding both copies at once reports ADDED TWICE",
  withRepo((dir) => {
    write(dir, "seed.js", "export const seed = 1;\n");
    commit(dir, "base");
    write(dir, "a.js", body("alpha"));
    write(dir, "b.js", body("beta"));
    commit(dir, "add both copies");
    assertFlags(dir, /ADDED TWICE/);
  }),
);

maybe(
  "deleting the only difference between two blocks is detected",
  withRepo((dir) => {
    const divergent = body("beta").replace(
      "  const total =",
      `${Array.from({ length: 8 }, (_, i) => `  const unique${i} = ${i};`).join("\n")}\n  const total =`,
    );
    write(dir, "a.js", body("alpha"));
    write(dir, "b.js", divergent);
    commit(dir, "base with divergent blocks");
    write(dir, "b.js", body("beta"));
    commit(dir, "delete divergence");
    assertFlags(dir, /DUPLICATES EXISTING/);
  }),
);

maybe(
  "rewriting both sides in place creates a new clone identity",
  withRepo((dir) => {
    seedExistingPair(dir);
    write(dir, "a.js", replacementBody("alpha"));
    write(dir, "b.js", replacementBody("beta"));
    commit(dir, "replace both implementations with a new duplicate");
    assertFlags(dir, /ADDED TWICE/);
  }),
);

maybe(
  "shortening a pre-existing clone does not create duplication",
  withRepo((dir) => {
    seedExistingPair(dir);
    write(
      dir,
      "b.js",
      body("beta").replace(
        "  const total = parts.reduce((sum, p) => sum + p.length, 0);\n  return { ok: true, reason: null, value: total, parts, count: parts.length };",
        "  const first = parts[0] ?? null;\n  return { ok: true, reason: null, value: first, parts, count: parts.length };",
      ),
    );
    commit(dir, "diverge after the shared prefix");
    assertClean(dir);
  }),
);

maybe(
  "the same helper written twice in one file is reported",
  withRepo((dir) => {
    write(dir, "seed.js", "export const seed = 1;\n");
    commit(dir, "base");
    write(dir, "twice.js", body("alpha") + body("beta"));
    commit(dir, "same helper twice in one file");
    assertFlags(dir, /twice\.js/);
  }),
);

maybe(
  "pre-existing duplication is NOT reported when the diff does not touch it",
  withRepo((dir) => {
    seedExistingPair(dir);
    write(dir, "unrelated.js", "export const x = 1;\n");
    commit(dir, "unrelated change");
    assertClean(dir);
  }),
);

maybe(
  "an in-progress merge uses the live base tip regardless of parent order",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "shared base");
    const staleRemoteMain = git(dir, "rev-parse", "main").trim();
    git(dir, "update-ref", "refs/remotes/origin/main", staleRemoteMain);
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, "feature.js", "export const feature = true;\n");
    commit(dir, "feature change");

    git(dir, "checkout", "-q", "main");
    write(dir, "b.js", body("beta"));
    commit(dir, "main adds pre-existing duplication");
    const mainTip = git(dir, "rev-parse", "main").trim();
    git(dir, "update-ref", "refs/remotes/origin/master", mainTip);

    git(dir, "checkout", "-q", "-b", "branch-first", "feature");
    git(dir, "merge", "--no-commit", "--no-ff", "main");
    const branchFirstLocal = exec(dir, ["--json"]);
    assert.equal(
      branchFirstLocal.code,
      0,
      branchFirstLocal.stdout + branchFirstLocal.stderr,
    );
    const branchFirstExplicit = exec(dir, ["--base", "main", "--json"]);
    assert.equal(
      branchFirstExplicit.code,
      0,
      branchFirstExplicit.stdout + branchFirstExplicit.stderr,
    );
    commit(dir, "merge main into feature");
    const branchFirstCi = exec(dir, ["--base", "main", "--json"]);
    assert.equal(
      branchFirstCi.code,
      0,
      branchFirstCi.stdout + branchFirstCi.stderr,
    );

    git(dir, "checkout", "-q", "-b", "main-first", "main");
    git(dir, "merge", "--no-commit", "--no-ff", "feature");
    const mainFirstLocal = exec(dir, ["--json"]);
    assert.equal(
      mainFirstLocal.code,
      0,
      mainFirstLocal.stdout + mainFirstLocal.stderr,
    );
    commit(dir, "merge feature into main");
    const mainFirstCi = exec(dir, ["--base", "main", "--json"]);
    assert.equal(mainFirstCi.code, 0, mainFirstCi.stdout + mainFirstCi.stderr);

    const results = [
      branchFirstLocal,
      branchFirstExplicit,
      branchFirstCi,
      mainFirstLocal,
      mainFirstCi,
    ].map((result) => JSON.parse(result.stdout));
    for (const result of results) {
      assert.equal(result.mergeBase, mainTip);
      assert.deepEqual(result.findings, []);
    }
    assert.deepEqual(results[0].findings, results[1].findings);
    assert.deepEqual(results[1].findings, results[2].findings);
    assert.deepEqual(results[2].findings, results[3].findings);
  }),
);

maybe(
  "CI scans duplication introduced only by combining the PR with the live base",
  withRepo((dir) => {
    write(dir, "seed.js", "export const seed = true;\n");
    commit(dir, "shared base");

    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, "feature.js", body("alpha"));
    commit(dir, "feature adds one implementation");

    git(dir, "checkout", "-q", "main");
    write(dir, "base.js", body("beta"));
    commit(dir, "main independently adds the duplicate");
    const mainTip = git(dir, "rev-parse", "main").trim();
    git(dir, "update-ref", "refs/remotes/origin/master", mainTip);

    git(dir, "checkout", "-q", "feature");
    git(dir, "merge", "--no-commit", "--no-ff", "main");
    const combined = exec(dir, ["--base", "main", "--json"]);
    assert.equal(combined.code, 1, combined.stdout + combined.stderr);
    const result = JSON.parse(combined.stdout);
    assert.equal(result.mergeBase, mainTip);
    assert.ok(
      result.findings.some(
        (finding) => finding.verdict === "duplicates-existing",
      ),
    );
  }),
);

maybe(
  "whitespace-only edits to a pre-existing clone do not fail the ratchet",
  withRepo((dir) => {
    seedExistingPair(dir);
    write(
      dir,
      "b.js",
      body("beta").replace("const trimmed =", "const    trimmed    ="),
    );
    commit(dir, "reformat existing clone");
    assertClean(dir);
  }),
);

maybe(
  "comment-only edits to a pre-existing clone do not fail the ratchet",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    write(
      dir,
      "b.js",
      body("beta").replace("  const parts =", "  // old note\n  const parts ="),
    );
    commit(dir, "base with existing duplication");
    write(
      dir,
      "b.js",
      body("beta").replace(
        "  const parts =",
        "  // revised note\n  const parts =",
      ),
    );
    commit(dir, "edit a comment in existing clone");
    assertClean(dir);
  }),
);

maybe(
  "comment-only edits inside both template interpolations stay pre-existing",
  withRepo((dir) => {
    const withComment = (tag, note) =>
      body(tag).replace(
        '  const trimmed = String(input ?? "").trim();',
        `  const trimmed = \`\${String(input ?? "") /* ${note} */}\`.trim();`,
      );
    write(dir, "a.js", withComment("alpha", "old note"));
    write(dir, "b.js", withComment("beta", "old note"));
    commit(dir, "base with template interpolation comments");
    write(dir, "a.js", withComment("alpha", "revised note"));
    write(dir, "b.js", withComment("beta", "revised note"));
    commit(dir, "revise both interpolation comments");
    assertClean(dir);
  }),
);

maybe(
  "comment-only edits in clone slices beginning at division stay pre-existing",
  withRepo((dir) => {
    write(dir, "a.js", divisionArrayBody("alpha", "old note"));
    write(dir, "b.js", divisionArrayBody("beta", "old note"));
    commit(dir, "base with division-array clone");
    write(dir, "a.js", divisionArrayBody("alpha", "revised note"));
    write(dir, "b.js", divisionArrayBody("beta", "revised note"));
    commit(dir, "revise both division-array comments");
    assertClean(dir);
  }),
);

maybe(
  "edits outside exact clone columns stay pre-existing",
  withRepo((dir) => {
    write(dir, "a.js", inlineBoundaryBody("alpha", "old-a"));
    write(dir, "b.js", inlineBoundaryBody("beta", "old-b"));
    commit(dir, "base with mid-line clone boundaries");
    write(dir, "a.js", inlineBoundaryBody("alpha", "new-a"));
    write(dir, "b.js", inlineBoundaryBody("beta", "new-b"));
    commit(dir, "edit non-cloned prefixes on both sides");
    const result = exec(dir, ["--base", "main~1"]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
  }),
);

maybe(
  "renaming generated code into authored source is checked",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    writeFile(dir, "src/generated/b.js", body("beta"));
    commit(dir, "base with excluded duplicate");
    git(dir, "mv", "src/generated/b.js", "src/b.js");
    commit(dir, "promote helper to production");
    assertFlags(dir, /DUPLICATES EXISTING/);
  }),
);

maybe(
  "an eligible rename maps back to its merge-base path",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    write(dir, "b.js", body("beta"));
    commit(dir, "base with existing production duplicate");
    git(dir, "mv", "src/b.js", "src/renamed.js");
    commit(dir, "rename production helper");
    assertClean(dir);
  }),
);

maybe(
  "an edited rename may shift an unchanged clone without becoming new duplication",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    write(dir, "b.js", body("beta"));
    commit(dir, "base with existing production duplicate");
    git(dir, "mv", "src/b.js", "src/renamed.js");
    write(
      dir,
      "renamed.js",
      "// renamed module header\n".repeat(3) + body("beta"),
    );
    commit(dir, "rename and shift the existing clone");
    assertClean(dir);
  }),
);

maybe(
  "a renamed file cannot hide a newly added clone occurrence",
  withRepo((dir) => {
    write(dir, "duplicates.js", body("alpha") + body("beta"));
    commit(dir, "base with two occurrences");
    git(dir, "mv", "src/duplicates.js", "src/renamed.js");
    write(dir, "renamed.js", body("alpha") + body("beta") + body("gamma"));
    commit(dir, "rename and add a third occurrence");
    assertFlags(dir, /renamed\.js/);
  }),
);

maybe(
  "a renamed file cannot hide a replacement clone occurrence",
  withRepo((dir) => {
    write(
      dir,
      "duplicates.js",
      body("alpha") + body("beta") + replacementBody("unrelated"),
    );
    commit(dir, "base with two occurrences and unrelated code");
    git(dir, "mv", "src/duplicates.js", "src/renamed.js");
    write(dir, "renamed.js", body("alpha") + body("beta") + body("gamma"));
    commit(dir, "rename and replace unrelated code with a third occurrence");
    assertFlags(dir, /renamed\.js/);
  }),
);

maybe(
  "an unstaged filesystem rename maps back to its merge-base path",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    write(dir, "b.js", body("beta"));
    commit(dir, "base with existing production duplicate");
    write(dir, "seed.js", "export const seed = 1;\n");
    commit(dir, "second commit for the pre-commit comparison");
    renameSync(join(dir, "src", "b.js"), join(dir, "src", "renamed.js"));
    assertClean(dir);
  }),
);

maybe(
  "--json returns a result object when the tree is unchanged",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    const { code, stdout } = exec(dir, ["--base", "HEAD", "--json"]);
    assert.equal(code, 0, stdout);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.changedFiles, 0);
    assert.equal(parsed.scanned, 0);
    assert.deepEqual(parsed.findings, []);
  }),
);

// These two never reach jscpd, so they run everywhere.

test(
  "an unresolvable base is a setup error, not a pass",
  withRepo((dir) => {
    write(dir, "a.js", body("alpha"));
    commit(dir, "base");
    write(dir, "b.js", body("beta"));
    commit(dir, "dup");
    git(dir, "branch", "-m", "main", "develop");
    const r = exec(dir, []);
    assert.equal(
      r.code,
      2,
      `expected setup error, got ${r.code}: ${r.stdout}${r.stderr}`,
    );
    assert.match(r.stderr, /cannot determine a base ref/);
  }),
);

test(
  "unknown command-line arguments are setup errors",
  withRepo((dir) => {
    write(dir, "seed.js", "export const seed = 1;\n");
    commit(dir, "base");
    const result = exec(dir, ["--bas", "HEAD"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown argument '--bas'/);
  }),
);

test("a non-git directory is a setup error", () => {
  const dir = mkdtempSync(join(tmpdir(), "dupgate-nogit-"));
  try {
    const r = exec(dir, []);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "module extensions and test fixtures introduce copies without changing the index",
  withRepo((dir) => {
    write(dir, "a.mts", body("alpha"));
    commit(dir, "base");
    const before = git(dir, "write-tree").trim();
    write(dir, "b.cts", body("beta"));
    const status = git(dir, "status", "--porcelain=v1", "-z");
    const result = exec(dir, ["--base", "HEAD", "--json"]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.ok(
      JSON.parse(result.stdout).findings.some(
        (f) => f.b.endsWith(".cts") || f.a.endsWith(".cts"),
      ),
    );
    assert.equal(git(dir, "write-tree").trim(), before);
    assert.equal(git(dir, "status", "--porcelain=v1", "-z"), status);
  }),
);

test(
  "missing, malformed, and terminated scanner reports fail operationally",
  withRepo((dir) => {
    write(dir, "base.js", body("alpha"));
    commit(dir, "base");
    write(dir, "new.js", body("beta"));
    const harness = mkdtempSync(join(tmpdir(), "quality-scanner-"));
    try {
      for (const name of [
        "dup-gate.mjs",
        "quality-git.mjs",
        "ratchet-common.mjs",
      ])
        copyFileSync(join(dirname(GATE), name), join(harness, name));
      mkdirSync(join(harness, "node_modules", "jscpd"), { recursive: true });
      const modules = join(dirname(dirname(GATE)), "node_modules");
      symlinkSync(
        join(modules, "@jscpd"),
        join(harness, "node_modules", "@jscpd"),
        "junction",
      );
      symlinkSync(
        join(modules, "typescript"),
        join(harness, "node_modules", "typescript"),
        "junction",
      );
      const cli = join(harness, "node_modules", "jscpd", "run-jscpd.js");
      for (const code of [
        "",
        "require('node:fs').writeFileSync(require('node:path').join(process.argv[process.argv.indexOf('-o')+1],'jscpd-report.json'),'{}');",
        "process.kill(process.pid,'SIGTERM');",
      ]) {
        writeFileSync(cli, code);
        const result = runGate(join(harness, "dup-gate.mjs"), dir, [
          "--base",
          "HEAD",
          "--json",
        ]);
        assert.equal(result.code, 2, result.stdout + result.stderr);
      }
    } finally {
      rmSync(harness, { recursive: true, force: true });
    }
  }),
);

for (const mode of ["tracked ignored source", "source above one MiB"]) {
  test(
    mode + " retains duplication coverage",
    withRepo((dir) => {
      if (mode === "tracked ignored source") {
        writeFile(dir, ".gitignore", "src/original.js\n");
        write(dir, "original.js", body("alpha"));
        git(dir, "add", "-f", "src/original.js");
      } else write(dir, "original.js", body("alpha"));
      commit(dir, "eligible source");
      const padding =
        mode === "source above one MiB"
          ? "/*" + "x".repeat(1024 * 1024) + "*/\n"
          : "";
      write(dir, "copy.js", padding + body("beta"));
      assertFlags(dir, /DUPLICATES EXISTING/, "--base", "HEAD");
    }),
  );
}

test(
  "ignored untracked scratch cannot create a duplication finding",
  withRepo((dir) => {
    writeFile(dir, ".gitignore", "tmp/\n");
    commit(dir, "base");
    write(dir, "new.js", body("alpha"));
    writeFile(dir, "tmp/scratch.js", body("beta"));
    assertClean(dir, "--base", "HEAD");
  }),
);
