import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(
  new URL("run-shared-quality.mjs", import.meta.url),
);
const git = (dir, ...args) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const run = (script, home, args = []) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUALITY_RATCHET_HOME: home },
  });

test("missing local checkout gives setup instructions and operational exit", () => {
  for (const home of ["", join(tmpdir(), "missing-shared-quality-checkout")]) {
    const result = run(launcher, home);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /QUALITY_RATCHET_HOME/);
    assert.match(result.stderr, /0873869f6b8fd80150d24689849ec0aebd94e9dd/);
  }
});

test("the launcher refuses an incorrect release checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), "consumer-quality-"));
  try {
    git(dir, "init", "-q");
    git(
      dir,
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    );
    const result = run(launcher, dir);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /release|HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a clean pinned tool receives literal arguments and the current Node, with exits preserved", () => {
  const dir = mkdtempSync(join(tmpdir(), "consumer-quality-"));
  try {
    const home = join(dir, "tool with spaces");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(
      join(home, "bin/quality-ratchet.mjs"),
      "console.log(JSON.stringify({execPath:process.execPath,args:process.argv.slice(2)})); process.exitCode=Number(process.argv.at(-1));",
    );
    git(home, "init", "-q");
    git(home, "add", ".");
    git(
      home,
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    // Substitute only the release identity in this isolated fixture copy.
    mkdirSync(join(dir, "scripts"));
    const fixtureLauncher = join(dir, "scripts", "launcher.mjs");
    writeFileSync(
      fixtureLauncher,
      readFileSync(launcher, "utf8").replaceAll(
        "0873869f6b8fd80150d24689849ec0aebd94e9dd",
        git(home, "rev-parse", "HEAD"),
      ),
    );
    for (const code of [0, 1, 2]) {
      const result = run(fixtureLauncher, home, [
        "--base",
        "literal;$(echo should-not-run)",
        String(code),
      ]);
      assert.equal(result.status, code, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.execPath, process.execPath);
      assert.deepEqual(output.args, [
        "--repo",
        dir,
        "--base",
        "literal;$(echo should-not-run)",
        String(code),
      ]);
    }
    writeFileSync(
      join(home, "untracked-source.mjs"),
      "export const unsafe = true;\n",
    );
    let result = run(fixtureLauncher, home);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /clean/);
    rmSync(join(home, "untracked-source.mjs"));
    writeFileSync(join(home, "bin/quality-ratchet.mjs"), "process.exitCode=0;");
    result = run(fixtureLauncher, home);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /clean/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
