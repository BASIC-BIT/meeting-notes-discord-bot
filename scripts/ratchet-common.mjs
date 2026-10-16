// Shared CLI and git context for the diff-scoped ratchets
// (complexity-gate.mjs, file-size-gate.mjs).
//
// Reuses dup-gate's merge-base resolution, diff ranges, untracked-file
// handling and path filters so every gate agrees on what "this change" means.
// Nothing here decides pass or fail; each gate owns its own verdicts.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  changedRanges,
  isSourcePath,
  shQuiet,
  resolveMergeBase,
  SetupError,
} from "./quality-git.mjs";

const VALUE_FLAGS = { "--base": "base", "--repo": "repo" };
const BOOL_FLAGS = {
  "--json": "json",
  "-h": "help",
  "--help": "help",
};

export function parseRatchetArgs(argv) {
  const o = {
    base: null,
    repo: process.cwd(),
    json: false,
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length && !o.error; i++) {
    const flag = argv[i];
    if (flag in BOOL_FLAGS) {
      o[BOOL_FLAGS[flag]] = true;
    } else if (flag in VALUE_FLAGS) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) o.error = `${flag} needs a value`;
      else o[VALUE_FLAGS[flag]] = value;
    } else {
      o.error = `unknown argument: ${flag}`;
    }
  }
  return o;
}

const git = (args, cwd) => shQuiet("git", args, { cwd });

export function resolveRatchetContext(opts) {
  const repo = resolve(opts.repo);
  if (git(["rev-parse", "--git-dir"], repo) === null) {
    throw new SetupError(`${repo} is not a git repository.`);
  }
  const resolved = resolveMergeBase(repo, opts.base);
  if (!resolved) {
    throw new SetupError(
      opts.base
        ? `cannot find a merge base between '${opts.base}' and HEAD.`
        : "cannot determine a base ref (tried origin/HEAD, origin/main, origin/master, main, master). Pass --base.",
    );
  }
  const ranges = changedRanges(repo, resolved.mergeBase, opts);
  if (!ranges) throw new SetupError("could not read git diff.");
  return { repo, base: resolved.base, mergeBase: resolved.mergeBase, ranges };
}

export const readRepoFile = (repo, path) =>
  readFileSync(join(repo, path), "utf8");

/**
 * Shared front half of a gate's `main`: merge the defaults with the parsed
 * argv, answer `--help` and argument errors, resolve the git context and list
 * the source files to check. Returns `{ exit }` when the gate should stop
 * there, otherwise `{ opts, ctx, files }`.
 */
export function startRatchet(name, { argv, defaults, help }) {
  const opts = { ...defaults, ...parseRatchetArgs(argv) };
  if (opts.error) {
    console.error(`${name}: ${opts.error}\n${help}`);
    return { exit: 2 };
  }
  if (opts.help) {
    console.log(help);
    return { exit: 0 };
  }
  const ctx = resolveRatchetContext(opts);
  return {
    opts,
    ctx,
    files: [...ctx.ranges.keys()].filter((f) => isSourcePath(f, opts)),
  };
}

/**
 * File content at the merge base, or null when the path did not exist there.
 * `ls-tree` separates "absent" (empty output) from "git failed" (null) so a
 * broken checkout cannot masquerade as a brand-new file.
 */
export function showAtBase(repo, mergeBase, path) {
  const listed = git(["ls-tree", "--name-only", mergeBase, "--", path], repo);
  if (listed === null)
    throw new SetupError(`git ls-tree ${mergeBase} -- ${path} failed.`);
  if (listed.trim() === "") return null;
  const out = git(["show", `${mergeBase}:${path}`], repo);
  if (out === null)
    throw new SetupError(`git show ${mergeBase}:${path} failed.`);
  return out;
}

/**
 * Shared reporting tail: JSON, rendered findings, or the clean line, and the
 * exit code that goes with them. `render(meta)` is only called when there are
 * findings to print as text.
 */
export function reportRatchet(name, { ctx, opts, files, findings, render }) {
  const meta = { base: ctx.base, mergeBase: ctx.mergeBase };
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...meta,
          changedFiles: ctx.ranges.size,
          scanned: files.length,
          findings,
        },
        null,
        2,
      ),
    );
  } else if (findings.length) {
    console.log(render(meta));
  } else {
    console.log(
      `${name}: clean (${files.length} source file(s) checked against ${ctx.base}).`,
    );
  }
  return findings.length ? 1 : 0;
}

/** Run a gate's main() and map its outcome to the shared exit-code contract. */
export async function runRatchet(name, main) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error(
      e instanceof SetupError
        ? `${name}: ${e.message}`
        : (e?.stack ?? String(e)),
    );
    process.exitCode = 2;
  }
}
