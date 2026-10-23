/** @jest-environment node */
import { expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
const sync = workflow.jobs["sync-openai-connection"];
const step = sync?.steps.find(
  (item: { name: string }) => item.name === "Sync serving OpenAI connection",
);

test("production connection sync requires a successful backend and the event revision", () => {
  expect(sync.needs).toEqual(["deploybackend"]);
  expect(sync.if).toBeUndefined();
  expect(sync.environment).toBe("production");
  expect(workflow.on).not.toHaveProperty("pull_request");
  const checkout = sync.steps.find((item: { uses?: string }) =>
    item.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout.with?.ref).toBeUndefined();
  expect(step.run).not.toMatch(
    /GITHUB_(ENV|OUTPUT|STEP_SUMMARY)|upload-artifact|set -x/,
  );
});

test.each(["ci.yml", "ci-core.yml", "deploy-staging.yml"])(
  "%s never pushes live LLM connections",
  (name) => {
    expect(readFileSync(`.github/workflows/${name}`, "utf8")).not.toContain(
      "llm-connections:push",
    );
  },
);

const mockCli = `#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const failure = process.env.FIXTURE_FAILURE;
const option = (name) => args[args.indexOf(name) + 1];
fs.appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify({ command, args }) + "\\n");
if (command === "aws") {
  if (args[1] === "describe-services") {
    assert.equal(option("--cluster"), "fixture-cluster");
    assert.equal(option("--services"), "fixture-service");
    process.stdout.write(failure === "service" ? "None" : "arn:aws:ecs:us-east-1:123456789012:task-definition/fixture-bot-task:42");
  } else if (args[1] === "describe-task-definition") {
    assert.equal(option("--task-definition"), "arn:aws:ecs:us-east-1:123456789012:task-definition/fixture-bot-task:42");
    if (failure === "definition") process.exit(1);
    const environment = [
      { name: "DDB_TABLE_PREFIX", value: "fixture-" },
      { name: "OPENAI_PROJECT_ID", value: failure === "project" ? "" : "fixture-project" },
    ];
    const app = { name: "fixture-bot", environment };
    const sidecar = { name: "sidecar", environment: [{ name: "OPENAI_PROJECT_ID", value: "wrong-project" }] };
    process.stdout.write(JSON.stringify({ taskDefinition: { containerDefinitions: failure === "app" ? [sidecar] : [sidecar, app] } }));
  } else {
    assert.equal(args[1], "get-secret-value");
    assert.equal(option("--secret-id"), "fixture/openai-api-key");
    assert.equal(option("--version-stage"), "AWSCURRENT");
    if (failure === "key") process.exit(1);
    process.stdout.write(failure === "empty-key" ? "  " : "fixture-key");
  }
} else {
  assert.equal(command, "yarn");
  assert.equal(process.env.OPENAI_API_KEY, "fixture-key");
  assert.equal(process.env.OPENAI_PROJECT_ID, "fixture-project");
  const directory = option("--dir");
  assert.deepEqual(fs.readdirSync(directory), ["openai.yml"]);
  assert.equal(fs.readFileSync(path.join(directory, "openai.yml"), "utf8"), fs.readFileSync("langfuse/llm-connections/openai.yml", "utf8"));
  process.stdout.write("Connection command validated\\n");
  if (failure === "push" && !args.includes("--dry-run")) process.exit(1);
}
`;

function runSync(failure = "", prefix = "") {
  const directory = mkdtempSync(join(tmpdir(), "openai-sync-test-"));
  const calls = join(directory, "calls.jsonl");
  try {
    for (const command of ["aws", "yarn"]) {
      writeFileSync(join(directory, command), mockCli, { mode: 0o755 });
    }
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        TMPDIR: directory,
        ECS_CLUSTER: "fixture-cluster",
        ECS_SERVICE: "fixture-service",
        ECS_TASK_FAMILY: "fixture-bot-task",
        SECRETS_PREFIX: prefix,
        FIXTURE_FAILURE: failure,
        FIXTURE_CALLS: calls,
        GITHUB_ENV: join(directory, "github-env"),
        GITHUB_OUTPUT: join(directory, "github-output"),
        GITHUB_STEP_SUMMARY: join(directory, "github-summary"),
      },
    });
    expect(result.error).toBeUndefined();
    for (const file of ["github-env", "github-output", "github-summary"]) {
      expect(existsSync(join(directory, file))).toBe(false);
    }
    const invocations: { command: string; args: string[] }[] = existsSync(calls)
      ? readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    const yarn = invocations.filter((call) => call.command === "yarn");
    for (const call of yarn) {
      expect(existsSync(call.args[call.args.indexOf("--dir") + 1])).toBe(false);
    }
    const visible = result.stdout.replace(/^::add-mask::.*$/gm, "");
    expect(visible + result.stderr).not.toMatch(
      /fixture-key|fixture-project|wrong-project/,
    );
    return { ...result, yarn };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test.each(["", "fixture"])(
  "sync isolates OpenAI and verifies the push with prefix %j",
  (prefix) => {
    const result = runSync("", prefix);
    expect(result.status).toBe(0);
    expect(result.yarn.map((call) => call.args[0])).toEqual([
      "llm-connections:push",
      "llm-connections:push",
      "llm-connections:check",
    ]);
    expect(result.yarn.map((call) => call.args.includes("--dry-run"))).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.stdout.indexOf("::add-mask::fixture-key")).toBeLessThan(
      result.stdout.indexOf("Connection command validated"),
    );
    expect(result.stdout.indexOf("::add-mask::fixture-project")).toBeLessThan(
      result.stdout.indexOf("Connection command validated"),
    );
  },
);

test.each(["service", "definition", "app", "key", "empty-key", "project"])(
  "missing %s fails before any connection push",
  (failure) => {
    const result = runSync(failure);
    expect(result.status).not.toBe(0);
    expect(result.yarn).toEqual([]);
    expect(result.stdout + result.stderr).toContain("ERROR:");
  },
);

test("a failed live push prevents verification and cleans up", () => {
  const result = runSync("push");
  expect(result.status).not.toBe(0);
  expect(result.yarn).toHaveLength(2);
});
