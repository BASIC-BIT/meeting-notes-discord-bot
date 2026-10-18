#!/usr/bin/env node
// Fail on newly introduced or worsened debt compared with Git history.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import { overlaps, SetupError } from "./quality-git.mjs";
import {
  readRepoFile,
  reportRatchet,
  runRatchet,
  showAtBase,
  startRatchet,
} from "./ratchet-common.mjs";

export const DEFAULTS = { threshold: 15, includeTests: true };

const HELP = `complexity-gate: fail only when this diff adds or grows a function above cyclomatic or cognitive complexity ${DEFAULTS.threshold}.

  --base <ref>       compare against ref (default: origin/HEAD, then main/master)
  --repo <path>      repo to scan (default: cwd)
  --json             machine-readable output
  -h, --help         this text

Compares the merge base against the WORKING TREE, so uncommitted work counts.
Exit: 0 clean, 1 violation, 2 setup problem.`;

const keyName = (key) => {
  if (!key) return null;
  if (key.type === "Identifier" || key.type === "PrivateIdentifier")
    return key.name;
  if (key.type === "Literal") return String(key.value);
  return null;
};

const KEYED_PARENTS = new Set([
  "MethodDefinition",
  "PropertyDefinition",
  "Property",
]);

/**
 * Where a rule may start reporting this function. Both rules report a method,
 * a getter or a property function at its key, which sits before the function
 * node itself, so the record has to start at the key to contain the message.
 */
const headStart = (node) => {
  const p = node.parent;
  return p && KEYED_PARENTS.has(p.type) && p.value === node
    ? p.loc.start
    : node.loc.start;
};

const enclosingClassName = (node) => {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === "ClassDeclaration" || n.type === "ClassExpression")
      return n.id?.name ?? null;
  }
  return null;
};

const ACCESSOR_KINDS = new Set(["get", "set"]);

const OWNER_STOPS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassBody",
]);

/**
 * The variable an object-literal member ultimately belongs to: `createListing`
 * for `export const createListing = mutation({ handler })`. The walk stops at
 * a function or class boundary so the prefix never comes from an outer scope,
 * and an object literal with no declarator above it (a bare call argument, a
 * default export) has no owner.
 */
const objectLiteralOwner = (node) => {
  for (let n = node.parent; n && !OWNER_STOPS.has(n.type); n = n.parent) {
    if (n.type === "VariableDeclarator")
      return n.id.type === "Identifier" ? n.id.name : null;
  }
  return null;
};

/**
 * Name of a method or property function: `Class.m` in a class, `owner.m` for a
 * member of an object literal a variable holds, a bare `m` when there is no
 * such owner. An accessor carries its kind (`Class.get x`) so a getter and its
 * setter are never the same function to the ratchet.
 */
const memberName = (p) => {
  const key = keyName(p.key);
  if (key === null) return null;
  const named = ACCESSOR_KINDS.has(p.kind) ? `${p.kind} ${key}` : key;
  const owner =
    p.type === "Property" ? objectLiteralOwner(p) : enclosingClassName(p);
  return owner ? `${owner}.${named}` : named;
};

/**
 * Identity of a function for base-vs-head matching. Named things get their
 * name; methods get Class.method; anything else is null and is keyed by the
 * caller as <nearest named ancestor>#<ordinal>.
 */
export function functionName(node, sourceCode) {
  if (node.id) return node.id.name;
  const p = node.parent;
  if (!p) return null;
  if (p.type === "VariableDeclarator" && p.id.type === "Identifier")
    return p.id.name;
  if (KEYED_PARENTS.has(p.type) && p.value === node) return memberName(p);
  if (p.type === "AssignmentExpression" && p.right === node)
    return sourceCode.getText(p.left);
  return null;
}

// The recording rule pushes one record per function into this array. It is
// reset before every lintText call, and files are linted one at a time.
let records = [];

const recordFunctions = {
  rules: {
    functions: {
      create(ctx) {
        const stack = [{ key: "<module>", named: true, anon: 0 }];
        const enter = (node) => {
          const own = functionName(node, ctx.sourceCode);
          let key = own;
          if (key === null) {
            const ancestor = stack.findLast((f) => f.named);
            key = `${ancestor.key}#${++ancestor.anon}`;
          } else if (stack.length > 1) key = `${stack.at(-1).key}/${key}`;
          stack.push({ key, named: own !== null, anon: 0 });
          records.push({ key, start: headStart(node), end: node.loc.end });
        };
        const exit = () => stack.pop();
        return {
          FunctionDeclaration: enter,
          FunctionExpression: enter,
          ArrowFunctionExpression: enter,
          "FunctionDeclaration:exit": exit,
          "FunctionExpression:exit": exit,
          "ArrowFunctionExpression:exit": exit,
        };
      },
    },
  },
};

const makeLinter = (cwd) =>
  new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
          sourceType: "module",
        },
        linterOptions: { noInlineConfig: true },
        plugins: { sonarjs, ratchet: recordFunctions },
        rules: {
          complexity: ["error", 0],
          "sonarjs/cognitive-complexity": ["error", 0],
          "ratchet/functions": "error",
        },
      },
      {
        files: ["**/*.{cjs,cts}"],
        languageOptions: { sourceType: "commonjs" },
      },
    ],
  });

const before = (a, b) =>
  a.line < b.line || (a.line === b.line && a.column <= b.column);

/**
 * A record contains a message position when the message falls between the
 * record's head and its end. `headStart` already moves a method's record back
 * to its key, so this is a plain containment check. The caller's innermost
 * tie-break compares the raw start.
 */
const contains = (r, at) => before(r.start, at) && before(at, r.end);

const VALUE_RES = new Map([
  ["complexity", /complexity of (\d+)\./],
  ["sonarjs/cognitive-complexity", /from (\d+) to the/],
]);

/**
 * Disambiguate keys that repeat inside one file, in source order: the first
 * occurrence keeps its name, later ones get `~2`, `~3`. Base and head are
 * suffixed the same way, so without this a grown function could pass silently
 * against a same-named sibling's value.
 */
const uniqueKeys = (keys) => {
  const seen = new Map();
  return keys.map((k) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}~${n}`;
  });
};

/**
 * Attach each rule message to the innermost recorded function containing it.
 * `complexity` reports at the function head and SonarJS at the name or the
 * arrow token, so position containment is the join, not equality. A function
 * can draw more than one message from the same rule (a class field arrow is
 * both a method and a field initializer), so the highest value wins.
 *
 * A message whose value cannot be read is a setup error, never a 1/0 default:
 * a reworded upstream message would otherwise make every function look clean.
 * A message that lands in no recorded function is dropped, since a module-level
 * class static block legitimately reports without being a function.
 */
export function joinMessages(recs, messages, filePath = "<input>") {
  const keys = uniqueKeys(recs.map((r) => r.key));
  const families = Map.groupBy(recs, (r) => r.key);
  const fns = recs.map((r, i) => ({
    key: keys[i],
    familySize: families.get(r.key).length,
    start: r.start.line,
    end: r.end.line,
    cyclomatic: 1,
    cognitive: 0,
  }));
  for (const m of messages) {
    const re = VALUE_RES.get(m.ruleId);
    if (!re) continue;
    const found = re.exec(m.message);
    if (!found) {
      throw new SetupError(
        `${filePath}: unrecognised ${m.ruleId} message: ${m.message}`,
      );
    }
    const at = { line: m.line, column: m.column - 1 };
    let idx = -1;
    recs.forEach((r, i) => {
      if (contains(r, at) && (idx < 0 || before(recs[idx].start, r.start)))
        idx = i;
    });
    if (idx < 0) continue;
    const field = m.ruleId === "complexity" ? "cyclomatic" : "cognitive";
    fns[idx][field] = Math.max(fns[idx][field], Number(found[1]));
  }
  return fns;
}

async function lintSource(linter, text, filePath) {
  records = [];
  const [result] = await linter.lintText(text, { filePath });
  const fatal = result.messages.find((m) => m.fatal);
  if (fatal)
    throw new SetupError(`${filePath}:${fatal.line}: ${fatal.message}`);
  // A path ESLint declines to lint (its default node_modules ignore, say)
  // returns no records at all, which would otherwise read as a clean file.
  const ignored = result.messages.find(
    (m) => m.ruleId === null && /ignored/i.test(m.message),
  );
  if (ignored) throw new SetupError(`${filePath}: ${ignored.message}`);
  return joinMessages(records, result.messages, filePath);
}

export const candidates = (fns, ranges, threshold) =>
  fns.filter(
    (f) =>
      (f.cyclomatic > threshold || f.cognitive > threshold) &&
      ranges.some(([s, e]) => overlaps(s, e, f.start, f.end)),
  );

/** base === null means the file did not exist at the merge base. */
export function verdicts(cands, base) {
  const byKey = new Map((base ?? []).map((f) => [f.key, f]));
  const out = [];
  for (const f of cands) {
    const b = byKey.get(f.key);
    if (!b || f.familySize !== b.familySize)
      out.push({
        ...f,
        baseCyclomatic: null,
        baseCognitive: null,
        verdict: "NEW",
      });
    else if (f.cyclomatic > b.cyclomatic || f.cognitive > b.cognitive) {
      out.push({
        ...f,
        baseCyclomatic: b.cyclomatic,
        baseCognitive: b.cognitive,
        verdict: "GREW",
      });
    }
  }
  return out;
}

const withBase = (value, base) =>
  base === null ? `${value}` : `${value} (base ${base})`;

export function render(findings, threshold, meta) {
  const byFile = new Map();
  for (const f of findings)
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const lines = [
    `complexity-gate: ${findings.length} function(s) above ${threshold} introduced or grown by this change (base ${meta.base} @ ${meta.mergeBase.slice(0, 7)})`,
  ];
  for (const [file, fns] of byFile) {
    lines.push("", file);
    for (const f of fns) {
      lines.push(
        `  ${f.verdict.padEnd(5)} ${f.key}  L${f.start}-L${f.end}  cyclomatic ${withBase(f.cyclomatic, f.baseCyclomatic)}  cognitive ${withBase(f.cognitive, f.baseCognitive)}`,
      );
    }
  }
  lines.push(
    "",
    "Split the function, or leave an adjacent comment explaining why it must stay this way. Do not add an eslint-disable or an ignore entry.",
  );
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const started = startRatchet("complexity-gate", {
    argv,
    defaults: DEFAULTS,
    help: HELP,
  });
  if (started.exit !== undefined) return started.exit;
  const { opts, ctx, files } = started;
  const linter = makeLinter(ctx.repo);
  const findings = [];
  for (const file of files) {
    const head = await lintSource(
      linter,
      readRepoFile(ctx.repo, file),
      join(ctx.repo, file),
    );
    const cands = candidates(head, ctx.ranges.get(file), opts.threshold);
    if (cands.length === 0) continue;
    const basePath = ctx.ranges.renames.get(file) ?? file;
    const baseText = showAtBase(ctx.repo, ctx.mergeBase, basePath);
    const base =
      baseText === null
        ? null
        : await lintSource(linter, baseText, join(ctx.repo, basePath));
    for (const f of verdicts(cands, base)) findings.push({ file, ...f });
  }
  findings.sort(
    (a, b) =>
      Math.max(b.cyclomatic, b.cognitive) - Math.max(a.cyclomatic, a.cognitive),
  );
  return reportRatchet("complexity-gate", {
    ctx,
    opts,
    files,
    findings,
    render: (meta) => render(findings, opts.threshold, meta),
  });
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runRatchet("complexity-gate", main);
}
