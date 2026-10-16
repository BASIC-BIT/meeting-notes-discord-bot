import { createRequire } from "node:module";
import { qualityReport } from "./ratchet-test-helpers.mjs";
import { existsSync } from "node:fs";
import { extractRationale } from "./quality-policy.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { withRepo, write, git, commit } from "./ratchet-test-helpers.mjs";
const workflow = () =>
  parse(
    readFileSync(
      new URL("../.github/workflows/code-quality.yml", import.meta.url),
      "utf8",
    ),
  );
test("the dedicated check reruns on current PR and exception events", () => {
  const w = workflow();
  assert.deepEqual(w.on.pull_request.types, [
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
    "edited",
    "labeled",
    "unlabeled",
  ]);
  assert.deepEqual(Object.keys(w.on), ["pull_request"]);
  assert.equal(w.on.pull_request.paths, undefined);
  assert.deepEqual(w.permissions, {
    contents: "read",
    "pull-requests": "read",
  });
  assert.equal(w.concurrency["cancel-in-progress"], true);
  const job = w.jobs.quality;
  assert.equal(job.name, "Code quality ratchet");
  const checkout = job.steps.find((s) => s.name === "Checkout exact PR head");
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with["persist-credentials"], false);
  assert.match(checkout.with.ref, /pull_request.head.sha/);
  assert.ok(job.steps.find((s) => s.id === "policy").if.includes("always()"));
  assert.equal(job.secrets, undefined);
});
test("preparation precedes install and the policy consumes complete outcomes", () => {
  const steps = workflow().jobs.quality.steps;
  assert.ok(
    steps.findIndex((s) => s.id === "prepare") <
      steps.findIndex((s) => s.id === "install"),
  );
  assert.equal(
    steps.find((s) => s.id === "install").run,
    "bash scripts/ci-install-dependencies.sh",
  );
  assert.equal(
    steps.find((s) => s.id === "checker-tests")["continue-on-error"],
    true,
  );
  assert.equal(
    steps.find((s) => s.id === "checker-tests").run,
    "yarn test:quality",
  );
  const script = steps.find((s) => s.id === "policy").with.script;
  assert.match(script, /evaluatePolicy/);
  assert.match(script, /repos.getBranch/);
  assert.match(script, /pulls.get/);
  assert.match(script, /steps|CHECKER_TESTS/);
  assert.ok(
    steps
      .find((s) => s.name === "Upload quality reports")
      .if.includes("always()"),
  );
  assert.ok(!script.includes("${{"));
});
test(
  "actual preparation handles the live base, up-to-date branches, and conflicts",
  withRepo((dir) => {
    const runScript = workflow().jobs.quality.steps.find(
      (s) => s.id === "prepare",
    ).run;
    write(dir, "src/base.ts", "export const base=1;\n");
    commit(dir, "base");
    git(dir, "remote", "add", "origin", dir);
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, "src/feature.ts", "export const feature=1;\n");
    commit(dir, "feature");
    const head = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "main");
    write(dir, "src/current.ts", "export const current=1;\n");
    commit(dir, "advance base");
    const base = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "--detach", "-q", head);
    const shell =
      process.platform === "win32"
        ? join(process.env.ProgramFiles, "Git", "bin", "bash.exe")
        : "bash";
    const execute = () =>
      spawnSync(shell, ["-c", runScript], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          HEAD_SHA: git(dir, "rev-parse", "HEAD").trim(),
          BASE_REF: "main",
          GITHUB_OUTPUT: join(dir, "outputs"),
        },
      });
    let r = execute();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    let record = JSON.parse(
      readFileSync(join(dir, "quality-evidence.json"), "utf8"),
    );
    assert.equal(record.scanned.headSha, head);
    assert.equal(record.scanned.baseSha, base);
    assert.equal(
      readFileSync(join(dir, "src/current.ts"), "utf8").replace(/\r\n/g, "\n"),
      "export const current=1;\n",
    );
    git(dir, "merge", "--abort");
    git(dir, "checkout", "--detach", "-q", base);
    r = execute();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    write(dir, "src/base.ts", "export const base=2;\n");
    commit(dir, "branch changes shared file");
    const conflicting = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "main");
    write(dir, "src/base.ts", "export const base=3;\n");
    commit(dir, "base changes shared file");
    git(dir, "checkout", "--detach", "-q", conflicting);
    r = execute();
    assert.notEqual(r.status, 0);
  }),
);

test(
  "the actual policy adapter uses live metadata and cannot exempt a missing report",
  withRepo(async (dir) => {
    const script = workflow().jobs.quality.steps.find((s) => s.id === "policy")
      .with.script;
    for (const name of [
      "quality-policy.mjs",
      "check-quality.mjs",
      "ratchet-common.mjs",
      "quality-git.mjs",
    ])
      write(
        dir,
        "scripts/" + name,
        readFileSync(new URL(name, import.meta.url), "utf8"),
      );
    for (const name of [
      "jscpd",
      "@jscpd/tokenizer",
      "eslint",
      "eslint-plugin-sonarjs",
      "typescript-eslint",
      "typescript",
    ])
      write(
        dir,
        "node_modules/" + name + "/package.json",
        JSON.stringify({ version: "test" }),
      );
    write(
      dir,
      "quality-results.json",
      JSON.stringify(qualityReport([1, 0, 0])),
    );
    write(
      dir,
      "quality-evidence.json",
      JSON.stringify({
        scanned: {
          headSha: "a",
          baseRef: "master",
          baseSha: "b",
          treeSha: "t",
        },
      }),
    );
    const values = {
      GITHUB_WORKSPACE: dir,
      PREPARED: "success",
      INSTALLED: "success",
      CHECKER_TESTS: "success",
      SCAN_EXIT: "1",
    };
    const prior = Object.fromEntries(
      Object.keys(values).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, values);
    const failures = [];
    const summary = {
      addHeading() {
        return this;
      },
      addCodeBlock() {
        return this;
      },
      addDetails() {
        return this;
      },
      async write() {},
    };
    const core = { summary, setFailed: (message) => failures.push(message) };
    let liveBase = "b";
    const github = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              head: { sha: "a" },
              base: { ref: "master" },
              labels: [{ name: "quality-exception" }],
              body: "## Quality exception\nReviewed boundary.",
            },
          }),
        },
        repos: {
          getBranch: async () => ({ data: { commit: { sha: liveBase } } }),
        },
      },
    };
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const run = new AsyncFunction(
      "require",
      "github",
      "context",
      "core",
      script,
    );
    const applyPolicy = () =>
      run(
        createRequire(import.meta.url),
        github,
        { repo: { owner: "example", repo: "repo" }, issue: { number: 1 } },
        core,
      );
    try {
      await applyPolicy();
      assert.equal(failures.length, 0);
      assert.equal(
        JSON.parse(readFileSync(join(dir, "quality-evidence.json"), "utf8"))
          .result.outcome,
        "exception",
      );
      liveBase = "advanced";
      await applyPolicy();
      assert.equal(
        JSON.parse(readFileSync(join(dir, "quality-evidence.json"), "utf8"))
          .result.outcome,
        "stale",
      );
      rmSync(join(dir, "quality-results.json"));
      await applyPolicy();
      assert.equal(
        JSON.parse(readFileSync(join(dir, "quality-evidence.json"), "utf8"))
          .result.exitCode,
        2,
      );
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }),
);

test("local parity and deployments use the new policy without old suppressions", () => {
  const root = new URL("../", import.meta.url);
  const read = (name) => readFileSync(new URL(name, root), "utf8");
  const pkg = JSON.parse(read("package.json"));
  for (const command of ["check:parallel", "check:ci"]) {
    assert.match(pkg.scripts[command], /check:quality/);
    assert.match(pkg.scripts[command], /test:quality/);
  }
  assert.equal(pkg.scripts["check:quality"], "node scripts/check-quality.mjs");
  assert.match(pkg.scripts["code:stats"], /lizard -i -1/);
  assert.doesNotMatch(pkg.scripts["code:stats"], /-W/);
  assert.equal(existsSync(new URL("whitelizard.txt", root)), false);
  for (const name of [
    ".github/workflows/ci-core.yml",
    ".github/workflows/deploy-staging.yml",
  ]) {
    const text = read(name);
    assert.match(text, /lizard -i -1/);
    assert.doesNotMatch(text, /lizard -W/);
    assert.doesNotMatch(text, /run:.*check:quality/);
  }
  assert.match(
    read(".github/workflows/ci-core.yml"),
    /unittest discover -s analysis\/hallucination-audit/,
  );
  assert.match(
    read(".github/workflows/deploy.yml"),
    /uses: \.\/.github\/workflows\/ci-core.yml/,
  );
  const template = read(".github/pull_request_template.md");
  assert.match(template, /^## Quality exception$/m);
  assert.equal(extractRationale(template), null);
});
