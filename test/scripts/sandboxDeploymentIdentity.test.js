/** @jest-environment node */
import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import process from "node:process";

const role =
  "arn:aws:iam::123456789012:role/meeting-notes-sandbox-github-deploy";
const session = "chronote-sandbox-123-1";
const identity = {
  Account: "123456789012",
  Arn:
    "arn:aws:sts::123456789012:assumed-role/meeting-notes-sandbox-github-deploy/" +
    session,
};
const env = {
  ...process.env,
  EXPECTED_ACCOUNT_ID: "123456789012",
  EXPECTED_ROLE_ARN: role,
  EXPECTED_SESSION_NAME: session,
};

test("accepts the exact Sandbox role session", () => {
  expect(
    execFileSync("node", ["scripts/deployment/assert-sandbox-identity.cjs"], {
      env,
      input: JSON.stringify(identity),
      encoding: "utf8",
    }).trim(),
  ).toBe("Sandbox deployment identity verified");
});

test.each([
  { ...identity, Account: "999999999999" },
  { ...identity, Arn: "arn:aws:iam::123456789012:root" },
  { ...identity, Arn: identity.Arn.replace("sandbox", "prod") },
  { ...identity, Arn: identity.Arn + "-other" },
])(
  "refuses a foreign account, role or session without exposing it",
  (actor) => {
    try {
      execFileSync("node", ["scripts/deployment/assert-sandbox-identity.cjs"], {
        env,
        input: JSON.stringify(actor),
        stdio: ["pipe", "pipe", "pipe"],
      });
      throw new Error("identity was accepted");
    } catch (error) {
      expect(error.stderr.toString()).toBe(
        "Sandbox deployment identity mismatch\n",
      );
      expect(error.status).toBe(1);
    }
  },
);

test("backend uses OIDC and validates identity before any image or service write", () => {
  const workflow = parse(
    readFileSync(".github/workflows/deploy-staging.yml", "utf8"),
  );
  const backend = workflow.jobs.deploybackend;
  expect(backend.permissions).toEqual({
    contents: "read",
    "id-token": "write",
  });
  expect(backend.environment).toBe("sandbox");
  const auth = backend.steps.findIndex((step) =>
    step.uses?.startsWith("aws-actions/configure-aws-credentials@"),
  );
  expect(backend.steps[auth].with).toMatchObject({
    "role-to-assume": "${{ vars.SANDBOX_BACKEND_DEPLOY_ROLE_ARN }}",
    "allowed-account-ids": "${{ vars.AWS_ACCOUNT_ID }}",
    "role-duration-seconds": 10800,
    "unset-current-credentials": true,
  });
  expect(backend.steps[auth].with).not.toHaveProperty("aws-access-key-id");
  expect(backend.steps[auth].with).not.toHaveProperty("aws-secret-access-key");
  const check = backend.steps.findIndex((step) =>
    step.run?.includes("assert-sandbox-identity.cjs"),
  );
  const image = backend.steps.findIndex((step) => step.id === "build-image");
  expect(check).toBeGreaterThan(auth);
  expect(check).toBeLessThan(image);
  expect(backend["timeout-minutes"]).toBe(180);
});

test("identity canary cannot publish images or change services", () => {
  const workflow = parse(
    readFileSync(".github/workflows/sandbox-identity.yml", "utf8"),
  );
  expect(workflow.concurrency.group).toBe("chronote-deploy-sandbox");
  const job = workflow.jobs.identity;
  expect(job.environment).toBe("sandbox");
  const auth = job.steps.find((step) =>
    step.uses?.startsWith("aws-actions/configure-aws-credentials@"),
  );
  const policy = JSON.parse(auth.with["inline-session-policy"]);
  expect(policy.Statement).toHaveLength(1);
  expect(policy.Statement[0].Action).toBe("ecs:DescribeServices");
  expect(policy.Statement[0].Resource).toContain(":service/");
  expect(auth.with).not.toHaveProperty("aws-access-key-id");
});

test.each([
  "EXPECTED_ACCOUNT_ID",
  "EXPECTED_ROLE_ARN",
  "EXPECTED_SESSION_NAME",
])("missing %s refuses authentication", (key) => {
  const incomplete = { ...env };
  delete incomplete[key];
  expect(() =>
    execFileSync("node", ["scripts/deployment/assert-sandbox-identity.cjs"], {
      env: incomplete,
      input: JSON.stringify(identity),
      stdio: ["pipe", "pipe", "pipe"],
    }),
  ).toThrow();
});
