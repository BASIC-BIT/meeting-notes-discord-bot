#!/usr/bin/env node
// Fail on newly introduced or worsened debt compared with Git history.
import { pathToFileURL } from "node:url";
import {
  readRepoFile,
  reportRatchet,
  runRatchet,
  showAtBase,
  startRatchet,
} from "./ratchet-common.mjs";

export const DEFAULTS = { cap: 1000, includeTests: true };

const HELP = `file-size-gate: fail only when this diff creates or grows a file at or over ${DEFAULTS.cap} lines.

  --base <ref>       compare against ref (default: origin/HEAD, then main/master)
  --repo <path>      repo to scan (default: cwd)
  --json             machine-readable output
  -h, --help         this text

Compares the merge base against the WORKING TREE, so uncommitted work counts.
Exit: 0 clean, 1 violation, 2 setup problem.`;

/** Physical lines: a trailing newline does not start a new line. */
export function physicalLines(text) {
  if (text.length === 0) return 0;
  const count = text.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(text) ? count - 1 : count;
}

export function classify(file, lines, baseLines, cap = DEFAULTS.cap) {
  if (lines < cap) return null;
  if (baseLines === null)
    return { file, lines, baseLines: null, verdict: "NEW" };
  if (lines > baseLines) return { file, lines, baseLines, verdict: "GREW" };
  return null;
}

export function render(findings, cap, meta) {
  const head = `file-size-gate: ${findings.length} file(s) at or over ${cap} lines introduced or grown by this change (base ${meta.base} @ ${meta.mergeBase.slice(0, 7)})`;
  const rows = findings.map((f) =>
    f.verdict === "NEW"
      ? `  NEW   ${f.file}  ${f.lines} lines`
      : `  GREW  ${f.file}  ${f.lines} lines (base ${f.baseLines})`,
  );
  return [
    head,
    "",
    ...rows,
    "",
    "Split the file, or leave an adjacent comment explaining why it must grow. Do not add an ignore entry.",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const started = startRatchet("file-size-gate", {
    argv,
    defaults: DEFAULTS,
    help: HELP,
  });
  if (started.exit !== undefined) return started.exit;
  const { opts, ctx, files } = started;
  const findings = [];
  for (const file of files) {
    const lines = physicalLines(readRepoFile(ctx.repo, file));
    if (lines < opts.cap) continue;
    const basePath = ctx.ranges.renames.get(file) ?? file;
    const baseText = showAtBase(ctx.repo, ctx.mergeBase, basePath);
    const finding = classify(
      file,
      lines,
      baseText === null ? null : physicalLines(baseText),
      opts.cap,
    );
    if (finding) findings.push(finding);
  }
  findings.sort((a, b) => b.lines - a.lines);
  return reportRatchet("file-size-gate", {
    ctx,
    opts,
    files,
    findings,
    render: (meta) => render(findings, opts.cap, meta),
  });
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runRatchet("file-size-gate", main);
}
