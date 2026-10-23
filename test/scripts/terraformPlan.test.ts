/** @jest-environment node */
import { expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

function runPlan(scope: string) {
  const workflow = parse(
    readFileSync(".github/workflows/terraform-plan.yml", "utf8"),
  );
  const command = workflow.jobs.plan.steps.find(
    (step: { name: string }) => step.name === "Terraform plan",
  ).run;
  const directory = mkdtempSync(join(tmpdir(), "chronote-plan-"));
  mkdirSync(join(directory, "_infra"));
  try {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `terraform() { printf '%s\\n' "$@" > arguments.txt; }; ${command}`,
      ],
      {
        cwd: directory,
        env: { ...process.env, PLAN_SCOPE: scope, GITHUB_OUTPUT: "output.txt" },
        encoding: "utf8",
      },
    );
    const argsPath = join(directory, "arguments.txt");
    return {
      ...result,
      args: existsSync(argsPath)
        ? readFileSync(argsPath, "utf8").trim().split("\n")
        : [],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test.each([
  { scope: "full", targets: [] },
  {
    scope: "purchase-permission",
    targets: ["-target=aws_iam_role_policy.initial_purchase_condition"],
  },
  {
    scope: "deployment-prerequisites",
    targets: [
      "-target=aws_dynamodb_table.deployment_control_table",
      "-target=aws_lb_target_group.api_spare_tg[0]",
      "-target=aws_iam_role_policy.deployment_control",
      "-target=aws_iam_policy.deployment_routing[0]",
    ],
  },
])(
  "Terraform $scope plan invokes only the selected scope",
  ({ scope, targets }) => {
    const result = runPlan(scope);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.args).toEqual([
      "-chdir=_infra",
      "plan",
      "-no-color",
      "-input=false",
      "-detailed-exitcode",
      "-out=tfplan",
      ...targets,
    ]);
  },
);

test.each(["unknown", "", "full -target=aws_ecs_service.app_service"])(
  "Terraform refuses unsupported scope %j without invoking Terraform",
  (scope) => {
    const result = runPlan(scope);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Unsupported PLAN_SCOPE");
    expect(result.args).toEqual([]);
  },
);
