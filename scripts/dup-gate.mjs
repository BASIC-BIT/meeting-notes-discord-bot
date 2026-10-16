#!/usr/bin/env node
// Compare token clones with Git history; existing copies are not cleanup debt.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startRatchet } from "./ratchet-common.mjs";
import { tokenize } from "@jscpd/tokenizer";
import ts from "typescript";
import {
  SetupError,
  norm,
  touchesDiff,
  overlaps,
  isSourcePath,
  EXCLUDE_DIRS,
  GENERATED_SCAN_GLOBS,
  SUBPROCESS_TIMEOUT_MS,
} from "./quality-git.mjs";
const DEFAULTS = { minLines: 8, minTokens: 50, includeTests: true };
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const JSCPD_CLI = join(
  SCRIPT_DIR,
  "..",
  "node_modules",
  "jscpd",
  "run-jscpd.js",
);
const SEP = "\0";
const NORMALIZED_ENDPOINTS = Symbol("normalizedCloneEndpoints");
const JS_LIKE_FORMATS = new Set(["javascript", "typescript", "tsx"]);
const FORMAT_BY_EXTENSION = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
};
export function normalizedCloneContains(base, current) {
  return Boolean(base && current && base.includes(current));
}

function parseJsSource(source, format) {
  const scriptKind =
    format === "tsx"
      ? ts.ScriptKind.TSX
      : format === "javascript"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    `clone.${format}`,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const ranges = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      ranges.push([node.getStart(sourceFile), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { regexRanges: ranges };
}

function findJsRegexRanges(source, format) {
  return parseJsSource(source, format).regexRanges;
}

function isMisclassifiedComment(source, format, tokens, index, ranges = []) {
  return (
    JS_LIKE_FORMATS.has(format) &&
    ranges.some(
      ([start, end]) =>
        start < tokens[index].range[0] && tokens[index].range[0] < end,
    )
  );
}
function normalizeCloneSource(source, format = "text", jsRegexRanges) {
  let tokens;
  try {
    tokens = tokenize(source, format);
  } catch {
    tokens = [{ type: "raw", value: source, range: [0, source.length] }];
  }
  jsRegexRanges ??= JS_LIKE_FORMATS.has(format)
    ? findJsRegexRanges(source, format)
    : [];
  return (
    "\0" +
    tokens
      .filter((token, tokenIndex) => {
        if (token.type === "empty" || token.type === "new_line") return false;
        if (token.type !== "comment") return true;
        return isMisclassifiedComment(
          source,
          format,
          tokens,
          tokenIndex,
          jsRegexRanges,
        );
      })
      .map((token) => JSON.stringify([token.type, token.value]))
      .join("\0") +
    "\0"
  );
}

function fingerprintNormalizedClone(normalized, format) {
  return createHash("sha256")
    .update(format)
    .update("\0")
    .update(normalized)
    .digest("hex");
}

export function fingerprintCloneSource(source, format = "text") {
  return fingerprintNormalizedClone(
    normalizeCloneSource(source, format),
    format,
  );
}

function normalizeCloneSourceRange(
  source,
  format,
  startOffset,
  endOffset,
  fullFileRegexRanges,
) {
  const fragment = source.slice(startOffset, endOffset);
  const jsRegexRanges = JS_LIKE_FORMATS.has(format)
    ? (fullFileRegexRanges ?? findJsRegexRanges(source, format))
        .filter(([start, end]) => start < endOffset && end > startOffset)
        .map(([start, end]) => [start - startOffset, end - startOffset])
    : [];
  return normalizeCloneSource(fragment, format, jsRegexRanges);
}

function relTo(repo, p) {
  const n = norm(p);
  const r = norm(repo).replace(/\/$/, "");
  return n.startsWith(r + "/") ? n.slice(r.length + 1) : n;
}

function scannerRepoPath(repo, scannerName, format) {
  const relative = relTo(repo, scannerName);
  const embeddedSuffix = `:${format}`;
  if (relative.endsWith(embeddedSuffix)) {
    const container = relative.slice(0, -embeddedSuffix.length);
    if (existsSync(resolve(repo, container))) return container;
  }
  return relative;
}

function scannerFilePath(repo, scannerName, format) {
  const candidate = resolve(repo, scannerRepoPath(repo, scannerName, format));
  return existsSync(candidate) ? candidate : null;
}

function scannerSourceRange(source, file) {
  const startLine = file.startLoc?.line ?? file.start;
  const endLine = file.endLoc?.line ?? file.end;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  const startLineOffset = lineStarts[startLine - 1];
  const endLineOffset = lineStarts[endLine - 1];
  if (startLineOffset === undefined || endLineOffset === undefined)
    return [0, 0];

  const contentEnd = (line) => {
    let offset = lineStarts[line] ?? source.length;
    if (source[offset - 1] === "\n") offset -= 1;
    if (source[offset - 1] === "\r") offset -= 1;
    return offset;
  };
  const startColumn = file.startLoc?.column;
  const endColumn = file.endLoc?.column;
  const startOffset = Math.min(
    contentEnd(startLine),
    startLineOffset + (Number.isInteger(startColumn) ? startColumn : 0),
  );
  const endOffset = Number.isInteger(endColumn)
    ? Math.min(contentEnd(endLine), endLineOffset + endColumn)
    : contentEnd(endLine);
  return [startOffset, Math.max(startOffset, endOffset)];
}

export function sliceScannerSource(source, file) {
  const range = scannerSourceRange(source, file);
  return range === null ? null : source.slice(...range);
}

function sourceIdentityContext(path, format, cache) {
  if (!cache.has(path)) {
    const source = readFileSync(path, "utf8");
    cache.set(path, {
      source,
      fullFileRegexRanges: findJsRegexRanges(
        source,
        FORMAT_BY_EXTENSION[extname(path)] ?? format,
      ),
    });
  }
  return cache.get(path);
}
async function fingerprintScannerEndpoint(
  repo,
  file,
  format,
  cache,
  fallback = null,
) {
  const path = scannerFilePath(repo, file.name, format);
  let normalized;
  if (path) {
    const { source, fullFileRegexRanges } = sourceIdentityContext(
      path,
      format,
      cache,
    );
    const range = scannerSourceRange(source, file);
    if (range === null)
      throw new SetupError("scanner returned an invalid source range");
    normalized = normalizeCloneSourceRange(
      source,
      format,
      ...range,
      fullFileRegexRanges,
    );
  } else if (fallback !== null)
    normalized = normalizeCloneSource(fallback, format);
  else throw new SetupError("scanner endpoint is unavailable");
  return {
    fingerprint: fingerprintNormalizedClone(normalized, format),
    normalized,
  };
}
export async function runJscpd(repo, opts) {
  if (!existsSync(JSCPD_CLI)) {
    throw new SetupError("locked jscpd dependency is missing; run npm ci");
  }
  const out = mkdtempSync(join(tmpdir(), "dupgate-"));
  try {
    writeFileSync(
      join(out, "config.json"),
      JSON.stringify({
        pattern: "**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}",
        formatsExts: {
          javascript: ["js", "jsx", "mjs", "cjs"],
          typescript: ["ts", "mts", "cts"],
          tsx: ["tsx"],
        },
        followSymlinks: false,
        ignore: [
          ...EXCLUDE_DIRS.map((d) => `**/${d}/**`),
          ...GENERATED_SCAN_GLOBS,
          "**/src-tauri/gen/**",
          "**/*.d.mts",
          "**/*.d.cts",
        ],
      }),
    );
    const args = [
      JSCPD_CLI,
      ".",
      "--config",
      join(out, "config.json"),
      "-k",
      String(opts.minTokens),
      "-l",
      String(opts.minLines),
      "--skip-comments",
      "--no-tips",
      "--silent",
      "-i",
      [...EXCLUDE_DIRS.map((d) => `**/${d}/**`), ...GENERATED_SCAN_GLOBS].join(
        ",",
      ),
      "-r",
      "json,silent",
      "-o",
      out,
    ];
    try {
      execFileSync(process.execPath, args, {
        cwd: repo,
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
    } catch (e) {
      const detail = String(e.stderr ?? "")
        .trim()
        .split("\n")
        .slice(-2)
        .join(" ");
      throw new SetupError(`jscpd failed to run${detail ? `: ${detail}` : ""}`);
    }

    const reportPath = join(out, "jscpd-report.json");
    if (!existsSync(reportPath))
      throw new SetupError("jscpd produced no report file");
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      throw new SetupError("jscpd produced an unreadable report file");
    }

    if (!Array.isArray(report.duplicates))
      throw new SetupError("jscpd returned no duplicate array");
    const sourceCache = new Map();
    const rows = await Promise.all(
      report.duplicates.map(async (d) => {
        const [aIdentity, bIdentity] = await Promise.all([
          fingerprintScannerEndpoint(
            repo,
            d.firstFile,
            d.format,
            sourceCache,
            d.fragment,
          ),
          fingerprintScannerEndpoint(repo, d.secondFile, d.format, sourceCache),
        ]);

        return {
          kind: "token",
          a: scannerRepoPath(repo, d.firstFile.name, d.format),
          aFormat: d.format,
          as: d.firstFile.start,
          ae: d.firstFile.end,
          af: aIdentity.fingerprint,
          b: scannerRepoPath(repo, d.secondFile.name, d.format),
          bFormat: d.format,
          bs: d.secondFile.start,
          be: d.secondFile.end,
          bf: bIdentity.fingerprint,
          lines: d.lines,
          tokens: d.tokens,
          [NORMALIZED_ENDPOINTS]: {
            a: aIdentity.normalized,
            b: bIdentity.normalized,
          },
        };
      }),
    );
    return rows.filter(Boolean);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

async function scanMergeBase(repo, mergeBase, opts) {
  const root = mkdtempSync(join(tmpdir(), "dupgate-base-"));
  const snapshot = join(root, "tree");
  const env = { ...process.env, GIT_INDEX_FILE: join(root, "index") };
  try {
    mkdirSync(snapshot);
    execFileSync("git", ["read-tree", mergeBase], {
      cwd: repo,
      env,
      stdio: "ignore",
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
    execFileSync(
      "git",
      [
        "checkout-index",
        "--all",
        "--force",
        `--prefix=${norm(resolve(snapshot))}/`,
      ],
      {
        cwd: repo,
        env,
        stdio: "ignore",
        timeout: SUBPROCESS_TIMEOUT_MS,
      },
    );
    return await runJscpd(snapshot, opts);
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError("could not materialize the merge-base snapshot");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function dedupe(findings) {
  const kept = [];
  for (const f of findings) {
    const seen = kept.some((k) => findingsOverlap(k, f));
    if (!seen) kept.push(f);
  }
  return kept;
}

function findingsOverlap(a, b) {
  return (
    (a.a === b.a &&
      a.b === b.b &&
      overlaps(a.as, a.ae, b.as, b.ae) &&
      overlaps(a.bs, a.be, b.bs, b.be)) ||
    (a.a === b.b &&
      a.b === b.a &&
      overlaps(a.as, a.ae, b.bs, b.be) &&
      overlaps(a.bs, a.be, b.as, b.ae))
  );
}

function eligibleRow(r, opts) {
  if (!isSourcePath(r.a) || !isSourcePath(r.b)) return null;
  // Same-file pairs are kept: writing the same helper twice in the file you
  // are editing is the most common agent mistake. Only reject a fragment
  // matched against itself.
  if (r.a === r.b && overlaps(r.as, r.ae, r.bs, r.be)) return null;

  if (r.lines < opts.minLines) return null;

  return r;
}

export function classify(rows, ranges, opts) {
  const findings = [];
  for (const r of rows) {
    const eligible = eligibleRow(r, opts);
    if (!eligible) continue;

    const aNew = touchesDiff(ranges, eligible.a, eligible.as, eligible.ae);
    const bNew = touchesDiff(ranges, eligible.b, eligible.bs, eligible.be);
    if (!aNew && !bNew) continue; // pre-existing: not this diff's problem

    const endpointExisted = (side) => {
      const path = eligible[side];
      const changes = ranges.renames;
      if (changes?.newPaths?.has(path)) return false;
      const start = eligible[`${side}s`];
      const end = eligible[`${side}e`];
      return !(changes?.hunks?.get(path) ?? ranges.hunks?.get(path) ?? []).some(
        (hunk) =>
          hunk.newCount > 0 &&
          start >= hunk.newStart &&
          end <= hunk.newStart + hunk.newCount - 1,
      );
    };
    const exactlyOneExisted =
      aNew && bNew && endpointExisted("a") !== endpointExisted("b");
    findings.push({
      ...eligible,
      aTouched: aNew,
      bTouched: bNew,
      verdict:
        aNew && bNew && !exactlyOneExisted
          ? "added-twice"
          : "duplicates-existing",
    });
  }
  return findings.sort(
    (x, y) => Number(y.sameName) - Number(x.sameName) || y.lines - x.lines,
  );
}

function translateCurrentRangeToBase(start, end, hunks) {
  const translateLine = (line) => {
    let offset = 0;
    for (const hunk of hunks) {
      if (hunk.newCount === 0) {
        // Git uses the line before the insertion point for +N,0 hunks. A
        // surviving line at that boundary therefore follows the deletion.
        if (hunk.newStart === 0 || line > hunk.newStart)
          offset += hunk.oldCount;
        continue;
      }
      const newEnd = hunk.newStart + hunk.newCount - 1;
      if (line > newEnd) {
        offset += hunk.oldCount - hunk.newCount;
      } else if (line >= hunk.newStart) {
        // A coordinate inside a replacement is unambiguous only when old and
        // new subranges have the same size. This relative mapping keeps
        // repeated occurrences inside broad rename hunks distinct.
        if (hunk.oldCount !== hunk.newCount) return null;
        return hunk.oldStart + (line - hunk.newStart);
      }
    }
    return line + offset;
  };
  const translatedStart = translateLine(start);
  const translatedEnd = translateLine(end);
  if (translatedStart === null || translatedEnd === null) return null;
  return [translatedStart, translatedEnd];
}

function endpointMatches(current, base, side, baseSide, renames) {
  const currentPath = current[side];
  const basePath = base[baseSide];
  const renamedFrom = renames.get(currentPath);
  const pathAtBase = renamedFrom ?? currentPath;
  if (pathAtBase !== basePath) return false;
  const translated = translateCurrentRangeToBase(
    current[`${side}s`],
    current[`${side}e`],
    renames.hunks?.get(currentPath) ?? [],
  );
  // On a stable path, raw overlap remains a precise occurrence identity when
  // a replacement changes line counts and cannot be translated. Renames do
  // not have that guarantee: a broad hunk can move identical occurrences.
  if (!translated) {
    const insidePureAddition = (renames.hunks?.get(currentPath) ?? []).some(
      (hunk) =>
        hunk.oldCount === 0 &&
        hunk.newCount > 0 &&
        current[`${side}s`] >= hunk.newStart &&
        current[`${side}e`] <= hunk.newStart + hunk.newCount - 1,
    );
    return (
      !renamedFrom &&
      !insidePureAddition &&
      overlaps(
        current[`${side}s`],
        current[`${side}e`],
        base[`${baseSide}s`],
        base[`${baseSide}e`],
      )
    );
  }
  return overlaps(
    translated[0],
    translated[1],
    base[`${baseSide}s`],
    base[`${baseSide}e`],
  );
}

function endpointIdentityMatches(current, base, side, baseSide) {
  const currentFingerprint = current[`${side}f`];
  const baseFingerprint = base[`${baseSide}f`];
  if (
    currentFingerprint &&
    baseFingerprint &&
    currentFingerprint === baseFingerprint
  )
    return true;
  const currentNormalized = current[NORMALIZED_ENDPOINTS]?.[side];
  const baseNormalized = base[NORMALIZED_ENDPOINTS]?.[baseSide];
  return normalizedCloneContains(baseNormalized, currentNormalized);
}

/** A candidate is pre-existing only when the same engine found the same file
 * pair in an isolated merge-base snapshot and at least one normalized endpoint
 * is unchanged. This keeps one-sided edits on the existing-clone side of the
 * ratchet while treating two in-place rewrites as a new clone identity. */
export function wasFindingPresentAtBase(
  finding,
  baselineRows,
  renames = new Map(),
) {
  return baselineRows.some((base) => {
    if (base.kind !== finding.kind) return false;
    // Overlapping ranges alone are not enough for token clones. A merge-base
    // clone may cover only the unchanged prefix/suffix around a difference;
    // deleting that difference creates a larger exact clone in the current
    // tree. Treat it as pre-existing only when the old exact clone was at
    // least as large as the current one. `lines` is a defensive fallback for
    // scanner reports that omit token counts.
    if (
      Number(base.tokens ?? base.lines) <
      Number(finding.tokens ?? finding.lines)
    ) {
      return false;
    }

    const direct =
      endpointMatches(finding, base, "a", "a", renames) &&
      endpointMatches(finding, base, "b", "b", renames);
    if (
      direct &&
      (endpointIdentityMatches(finding, base, "a", "a") ||
        endpointIdentityMatches(finding, base, "b", "b"))
    ) {
      return true;
    }

    const reversed =
      endpointMatches(finding, base, "a", "b", renames) &&
      endpointMatches(finding, base, "b", "a", renames);
    return (
      reversed &&
      (endpointIdentityMatches(finding, base, "a", "b") ||
        endpointIdentityMatches(finding, base, "b", "a"))
    );
  });
}

export function filterPreExisting(
  candidates,
  baselineRows,
  renames = new Map(),
) {
  const findings = [];
  let preExisting = 0;
  for (const finding of candidates) {
    if (wasFindingPresentAtBase(finding, baselineRows, renames)) {
      preExisting += 1;
    } else {
      findings.push(finding);
    }
  }
  return { findings: dedupe(findings), preExisting };
}

export function groupByFilePair(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = [f.a, f.b].sort().join(SEP);
    const g = groups.get(key);
    if (!g) groups.set(key, { top: f, extra: 0 });
    else if (f.lines > g.top.lines)
      groups.set(key, { top: f, extra: g.extra + 1 });
    else g.extra += 1;
  }
  return [...groups.values()].sort((x, y) => y.top.lines - x.top.lines);
}

const MAX_REPORTED_PAIRS = 20;

export function render(findings, meta) {
  if (!findings.length) {
    const seen = meta.scanned ?? 0;
    const notes = [];
    if (meta.preExisting)
      notes.push(
        `${meta.preExisting} touched pair(s) already existed at the merge base`,
      );
    const suffix = notes.length ? ` ${notes.join("; ")}.` : "";
    return `No duplication introduced by this change. (${seen} exact clone pairs repo-wide, none introduced here.)${suffix}`;
  }
  const groups = groupByFilePair(findings);
  const shown = groups.slice(0, MAX_REPORTED_PAIRS);
  const head =
    groups.length === findings.length
      ? `${findings.length} duplication finding(s) introduced by this change:`
      : `${findings.length} duplication finding(s) across ${groups.length} file pair(s), introduced by this change:`;
  const L = [head, ""];
  for (const { top: f, extra } of shown) {
    const tag =
      f.verdict === "added-twice" ? "ADDED TWICE" : "DUPLICATES EXISTING";
    L.push(`  ${tag} ${f.lines}L`);
    L.push(`    ${f.a}:${f.as}-${f.ae}`);
    L.push(`    ${f.b}:${f.bs}-${f.be}`);
    if (extra)
      L.push(
        `    (+${extra} more overlapping clone(s) between these two files)`,
      );
  }
  if (groups.length > shown.length) {
    L.push("");
    L.push(
      `  ... and ${groups.length - shown.length} more file pair(s). Use --json for the full list.`,
    );
  }
  L.push("");
  L.push("ADDED TWICE         -> extract one shared helper before merging.");
  L.push(
    "DUPLICATES EXISTING -> call the existing code instead of reimplementing it.",
  );
  if (meta.preExisting)
    L.push(
      `${meta.preExisting} touched pair(s) already existed at the merge base.`,
    );
  return L.join("\n");
}

const HELP =
  "dup-gate: Git-relative duplication. --base <ref> --repo <path> --json. Exit 0 clean, 1 regression, 2 setup failure.";
export async function main(argv = process.argv.slice(2)) {
  const started = startRatchet("dup-gate", {
    argv,
    defaults: DEFAULTS,
    help: HELP,
  });
  if (started.exit !== undefined) return started.exit;
  const { opts, ctx } = started;
  const resolved = ctx,
    ranges = ctx.ranges;
  if (ranges.size === 0) {
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            base: resolved.base,
            mergeBase: resolved.mergeBase,
            changedFiles: 0,
            scanned: 0,
            preExisting: 0,
            findings: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`No changed files vs ${resolved.base}. Nothing to check.`);
    }
    return 0;
  }

  let token;
  try {
    token = await runJscpd(opts.repo, opts);
  } catch (e) {
    if (e instanceof SetupError) {
      console.error(`dup-gate: ${e.message}`);
      return 2;
    }
    throw e;
  }

  let baseline;
  try {
    baseline = await scanMergeBase(opts.repo, resolved.mergeBase, opts);
  } catch (e) {
    if (e instanceof SetupError) {
      console.error(`dup-gate: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const baselineRows = baseline
    .map((row) => eligibleRow(row, opts))
    .filter(Boolean);
  const { findings: introduced, preExisting } = filterPreExisting(
    classify(token, ranges, opts),
    baselineRows,
    ranges.renames,
  );
  const findings = introduced;
  const scanned = token.length;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          base: resolved.base,
          mergeBase: resolved.mergeBase,
          changedFiles: ranges.size,
          scanned,
          preExisting,
          findings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(render(findings, { scanned, preExisting }));
  }
  return findings.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
