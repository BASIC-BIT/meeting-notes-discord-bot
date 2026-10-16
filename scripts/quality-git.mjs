import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
const TEST_RE =
  /(\.test\.|\.spec\.|\.stories\.|\/(?:tests?|test-utils|__tests__|e2e|fixtures?)\/|\/[^/]*fixtures?\.[^/]+$)/i;
export const EXCLUDE_DIRS = [
  "node_modules",
  "dist",
  ".next",
  "build",
  "coverage",
  ".turbo",
  "vendor",
  "target",
  "bin",
  "obj",
  "out",
  ".venv",
  ".git",
  ".worktrees",
  "worktrees",
  ".superpowers",
  ".terraform",
  ".docusaurus",
];

// These files are produced by package managers, framework code generators, or
// TypeScript declaration emit. Their repeated structure is not author-written
// code and cannot be usefully deduplicated in source. Keep this list semantic
// and tool-agnostic rather than accumulating per-finding path exceptions.
const GENERATED_ARTIFACT_RE =
  /(^|\/)(?:(?:package-lock|npm-shrinkwrap)\.json|(?:pnpm-lock|bun)\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|composer\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|\.terraform\.lock\.hcl)$|\.d\.ts$|(^|\/)(?:_generated|generated)(?:\/|$)/;
export const GENERATED_SCAN_GLOBS = [
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/composer.lock",
  "**/poetry.lock",
  "**/uv.lock",
  "**/Pipfile.lock",
  "**/.terraform.lock.hcl",
  "**/*.d.ts",
  "**/_generated/**",
  "**/generated/**",
];

export const isGeneratedArtifact = (path) =>
  GENERATED_ARTIFACT_RE.test(norm(path)) || /\.d\.[cm]ts$/.test(path);

// Wall-clock ceiling per external scan.
export const SUBPROCESS_TIMEOUT_MS = 180_000;

export class SetupError extends Error {}

export const shQuiet = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: SUBPROCESS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      ...opts,
    });
  } catch {
    return null;
  }
};

export const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

export const isTestPath = (path) => TEST_RE.test("/" + norm(path));

export const isSourcePath = (path) => {
  const p = norm(path);
  return (
    /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(p) &&
    !isGeneratedArtifact(p) &&
    !p.split("/").some((part) => EXCLUDE_DIRS.includes(part)) &&
    !/(^|\/)src-tauri\/gen\//.test(p)
  );
};
export function isRepoSourcePath(repo, path) {
  if (!isSourcePath(path)) return false;
  const parts = norm(path).split("/");
  try {
    return parts.every(
      (_, i) =>
        !lstatSync(join(repo, ...parts.slice(0, i + 1))).isSymbolicLink(),
    );
  } catch {
    return false;
  }
}
function decodeGitEscapes(s) {
  let decoded = "";
  for (let index = 0; index < s.length; index += 1) {
    if (s[index] !== "\\" || index + 1 >= s.length) {
      decoded += s[index];
      continue;
    }
    const octalBytes = [];
    while (s[index] === "\\" && /[0-7]/.test(s[index + 1] ?? "")) {
      const match = /^[0-7]{1,3}/.exec(s.slice(index + 1));
      octalBytes.push(Number.parseInt(match[0], 8));
      index += match[0].length + 1;
    }
    if (octalBytes.length) {
      decoded += Buffer.from(octalBytes).toString("utf8");
      index -= 1;
      continue;
    }
    const escaped = s[++index];
    const escapes = {
      a: "\x07",
      b: "\b",
      t: "\t",
      n: "\n",
      v: "\v",
      f: "\f",
      r: "\r",
      '"': '"',
      "\\": "\\",
    };
    decoded += Object.hasOwn(escapes, escaped)
      ? escapes[escaped]
      : `\\${escaped}`;
  }
  return decoded;
}
export function parseDiffPath(rest) {
  let s = rest;
  if (s.startsWith('"')) {
    const end = s.lastIndexOf('"');
    if (end > 0) s = s.slice(1, end);
    s = decodeGitEscapes(s);
  } else {
    const tab = s.indexOf("\t");
    if (tab !== -1) s = s.slice(0, tab);
  }
  if (s === "/dev/null") return null;
  return s.startsWith("b/") ? s.slice(2) : s;
}

/**
 * Parse `git diff --unified=0` into { file -> [[start,end], ...] }.
 *
 * The tricky part is telling a real `+++ b/x` header from diff *content*. An
 * added line whose text begins with "++ " renders as "+++ " once the diff
 * prepends its own "+", and any doc discussing diff syntax contains such lines.
 * Two earlier versions of this parser got fooled, retargeting `file` to a
 * garbage path and silently dropping every later hunk in that section.
 *
 * Content only ever appears *inside* a hunk, and headers only ever appear
 * between `diff --git` and the first `@@`. Tracking that position kills the
 * whole bug class rather than another instance of it: no matter what a line
 * looks like, it cannot be read as a header while we are inside a hunk.
 */
function isFileHeader(line, prev, inHunk) {
  return (
    !inHunk &&
    line.startsWith("+++ ") &&
    prev.startsWith("--- ") &&
    (/^\+\+\+ "?b\//.test(line) || line.slice(4).trim() === "/dev/null")
  );
}
function addDiffHunk(map, file, h) {
  const oldStart = Number(h[1]),
    oldCount = h[2] === undefined ? 1 : Number(h[2]);
  const start = Number(h[3]),
    count = h[4] === undefined ? 1 : Number(h[4]);
  if (!map.has(file)) map.set(file, []);
  if (!map.hunks.has(file)) map.hunks.set(file, []);
  map.hunks
    .get(file)
    .push({ oldStart, oldCount, newStart: start, newCount: count });
  if (count === 0) {
    const boundary = Math.max(1, start);
    map.get(file).push([Math.max(1, boundary - 1), boundary]);
  } else map.get(file).push([start, start + count - 1]);
}
export function parseUnifiedDiff(out) {
  const map = new Map();
  Object.defineProperty(map, "hunks", { value: new Map() });
  let file = null,
    inHunk = false,
    prev = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      file = null;
      prev = line;
      continue;
    }
    const header = isFileHeader(line, prev, inHunk);
    prev = line;
    if (header) {
      const p = parseDiffPath(line.slice(4).replace(/\r$/, ""));
      file = p ? norm(p) : null;
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!h) continue;
    inHunk = true;
    if (file) addDiffHunk(map, file, h);
  }
  return map;
}

export function parseRenameStatus(out) {
  const renames = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!status) continue;
    const oldPath = parts[i++];
    const newPath =
      status.startsWith("R") || status.startsWith("C") ? parts[i++] : null;
    if (status.startsWith("R") && oldPath && newPath) {
      renames.push({ oldPath: norm(oldPath), newPath: norm(newPath) });
    }
  }
  return renames;
}

function applyTrackedRenames(map, out) {
  for (const { oldPath, newPath } of parseRenameStatus(out)) {
    if (isSourcePath(oldPath) && isSourcePath(newPath))
      map.renames.set(newPath, oldPath);
    if (isSourcePath(newPath)) map.set(newPath, [[1, Number.MAX_SAFE_INTEGER]]);
  }
}
function pathsByBlob(repo, paths, base) {
  const grouped = new Map();
  for (const path of paths) {
    const args = base
      ? ["rev-parse", base + ":" + path]
      : ["hash-object", "--path=" + path, "--", path];
    const hash = shQuiet("git", args, { cwd: repo })?.trim();
    if (!hash) continue;
    if (!grouped.has(hash)) grouped.set(hash, []);
    grouped.get(hash).push(path);
  }
  return grouped;
}
function filesystemRenames(repo, mergeBase, deleted, untracked) {
  const oldByHash = pathsByBlob(repo, deleted, mergeBase),
    newByHash = pathsByBlob(repo, untracked, null);
  const pairs = new Map();
  for (const [hash, newPaths] of newByHash) {
    const oldPaths = oldByHash.get(hash) ?? [];
    if (oldPaths.length === 1 && newPaths.length === 1)
      pairs.set(newPaths[0], oldPaths[0]);
  }
  return pairs;
}
function addUntrackedPaths(map, untracked, pairs) {
  for (const path of untracked) {
    const old = pairs.get(path);
    if (old && isSourcePath(old) && isSourcePath(path))
      map.renames.set(path, old);
    if (!old) map.renames.newPaths.add(path);
    if (!map.has(path)) map.set(path, [[1, Number.MAX_SAFE_INTEGER]]);
  }
}
// Read the worktree and untracked files without touching the author's index.
export function changedRanges(repo, mergeBase) {
  const out = shQuiet(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=0",
      "--no-color",
      "--diff-filter=d",
      mergeBase,
    ],
    { cwd: repo },
  );
  const renames = shQuiet(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      "--diff-filter=R",
      mergeBase,
    ],
    { cwd: repo },
  );
  const untracked = shQuiet(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: repo },
  );
  const deleted = shQuiet(
    "git",
    [
      "diff",
      "--name-only",
      "-z",
      "--find-renames",
      "--diff-filter=D",
      mergeBase,
    ],
    { cwd: repo },
  );
  if ([out, renames, untracked, deleted].includes(null)) return null;
  const map = parseUnifiedDiff(out);
  map.renames = new Map();
  map.renames.hunks = map.hunks;
  map.renames.newPaths = new Set();
  applyTrackedRenames(map, renames);
  const paths = untracked.split("\0").filter(Boolean).map(norm);
  const removed = deleted.split("\0").filter(Boolean).map(norm);
  addUntrackedPaths(
    map,
    paths,
    filesystemRenames(repo, mergeBase, removed, paths),
  );
  for (const file of map.keys())
    if (!isRepoSourcePath(repo, file)) map.delete(file);
  return map;
}

export const overlaps = (s1, e1, s2, e2) =>
  Math.max(s1, s2) <= Math.min(e1, e2);

export function touchesDiff(ranges, file, start, end) {
  const rs = ranges.get(file);
  if (!rs) return false;
  return rs.some(([a, b]) => overlaps(start, end, a, b));
}

export function resolveMergeBase(repo, explicit) {
  const candidates = [];
  if (explicit) {
    candidates.push(explicit);
  } else {
    candidates.push("origin/master");
  }
  const mergeHead = shQuiet(
    "git",
    ["rev-parse", "--verify", "MERGE_HEAD^{commit}"],
    {
      cwd: repo,
    },
  )?.trim();
  const head = mergeHead
    ? shQuiet("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: repo,
      })?.trim()
    : null;
  const resolvedCandidates = candidates.flatMap((base) => {
    const commit = shQuiet(
      "git",
      ["rev-parse", "--verify", `${base}^{commit}`],
      {
        cwd: repo,
      },
    )?.trim();
    return commit ? [{ base, commit }] : [];
  });
  if (mergeHead) {
    for (const candidate of resolvedCandidates) {
      if (candidate.commit === head || candidate.commit === mergeHead) {
        return { base: candidate.base, mergeBase: candidate.commit };
      }
    }
  }
  for (const candidate of resolvedCandidates) {
    const mb = shQuiet("git", ["merge-base", candidate.base, "HEAD"], {
      cwd: repo,
    });
    if (mb && mb.trim()) return { base: candidate.base, mergeBase: mb.trim() };
  }
  return null;
}
