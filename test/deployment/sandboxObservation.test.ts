/** @jest-environment node */
import { collectSandboxObservation } from "../../scripts/deployment/observe-sandbox.cjs";
import { manifestHash } from "../../scripts/deployment/sandbox-manifest.cjs";

const account = "123456789012",
  region = "us-east-1";
const ecs = `arn:aws:ecs:${region}:${account}`,
  elb = `arn:aws:elasticloadbalancing:${region}:${account}`;
const manifest = {
  environment: "sandbox",
  accountId: account,
  region,
  principalArn: `arn:aws:iam::${account}:user/deployer`,
  operationId: "d2e9e384-2efe-469e-84e1-8f9b82b794af",
  sourceCommit: "a".repeat(40),
  tablePrefix: "test-sandbox-",
  bucket: "test-sandbox-bucket",
  cluster: "test-sandbox-cluster",
  service: "test-sandbox-service",
  containerName: "test-sandbox-bot",
  containerPort: 3001,
  runtimeMode: "all",
  legacyTaskDefinition: `${ecs}:task-definition/test-sandbox-task:1`,
  taskDefinition: `${ecs}:task-definition/test-sandbox-task:2`,
  imageDigest: `sha256:${"b".repeat(64)}`,
  listenerArn: `${elb}:listener/app/sandbox/1/2`,
  targetGroupA: `${elb}:targetgroup/sandbox-a/1`,
  targetGroupB: `${elb}:targetgroup/sandbox-b/2`,
  maintenance: {
    testOnly: true,
    workSettled: true,
    receiptSha256: "c".repeat(64),
    confirmedAt: "2026-10-15T10:00:00.000Z",
  },
};
test("observer paginates projections, separates requested flags from outcomes and never emits returned content", async () => {
  const calls: {
    service: string;
    operation: string;
    input: Record<string, unknown>;
  }[] = [];
  let pages = 0;
  const aws = async (
    service: string,
    operation: string,
    input: Record<string, unknown>,
  ) => {
    calls.push({ service, operation, input });
    if (service === "sts")
      return { Account: account, Arn: manifest.principalArn };
    if (service === "ecs" && operation === "describe-services")
      return {
        failures: [],
        services: [
          {
            serviceName: manifest.service,
            desiredCount: 1,
            runningCount: 1,
            pendingCount: 0,
            taskDefinition: manifest.taskDefinition,
          },
        ],
      };
    if (service === "ecs" && operation === "list-tasks")
      return { taskArns: [] };
    if (service === "elbv2" && operation === "describe-target-health")
      return { TargetHealthDescriptions: [] };
    if (service === "elbv2" && operation === "describe-listeners")
      return {
        Listeners: [
          {
            ListenerArn: manifest.listenerArn,
            DefaultActions: [
              {
                Type: "forward",
                ForwardConfig: {
                  TargetGroups: [
                    { TargetGroupArn: manifest.targetGroupA, Weight: 100 },
                    { TargetGroupArn: manifest.targetGroupB, Weight: 0 },
                  ],
                },
              },
            ],
          },
        ],
      };
    if (service === "dynamodb" && operation === "scan") {
      if (input.TableName === "test-sandbox-MeetingHistoryTable") {
        pages++;
        if (pages === 1)
          return {
            Items: [
              {
                timestamp: { S: "2026-10-15T09:00:00.000Z" },
                status: { S: "in_progress" },
                notes: { S: "PRIVATE" },
              },
            ],
            LastEvaluatedKey: { guildId: { S: "next" } },
          };
        return {
          Items: [
            {
              timestamp: { S: "2026-10-15T10:01:00.000Z" },
              status: { S: "in_progress" },
              updatedAt: { S: "2026-10-15T10:01:00.000Z" },
              notes: { S: "PRIVATE" },
              duration: { N: "0" },
            },
            {
              timestamp: { S: "2026-10-15T10:02:00.000Z" },
              status: { S: "complete" },
              transcribeMeeting: { BOOL: true },
              generateNotes: { BOOL: true },
              processing: {
                M: {
                  transcription: { S: "partial" },
                  notes: { S: "generated" },
                },
              },
              delivery: {
                M: {
                  notes: {
                    M: {
                      outcome: { S: "complete" },
                      sent: { N: "1" },
                      intended: { N: "1" },
                      errors: { L: [{ S: "PRIVATE" }] },
                    },
                  },
                },
              },
            },
          ],
        };
      }
      return { Items: [] };
    }
    throw new Error("Unexpected observer operation");
  };
  const r = await collectSandboxObservation({
    manifest,
    expectedSha256: manifestHash(manifest),
    aws,
    since: "2026-10-15T10:00:00.000Z",
    until: "2026-10-15T11:00:00.000Z",
    now: () => Date.parse("2026-10-15T11:00:00.000Z"),
  });
  expect(pages).toBe(2);
  expect(r.runtime).toMatchObject({
    expectedDigestTasks: 0,
    taskInventoryComplete: false,
  });
  expect(r.history).toMatchObject({
    records: 2,
    staleCandidates: 1,
    partialTranscriptions: 1,
    requestedTranscription: 1,
    deliveredNotes: 1,
  });
  expect(r.evidence).toMatchObject({
    crashRecovery: "NOT_OBSERVED",
    simultaneousMultiServerAdmission: "NOT_OBSERVED",
  });
  expect(JSON.stringify(r)).not.toContain("PRIVATE");
  const scans = calls.filter((c) => c.operation === "scan");
  expect(scans.every((c) => Boolean(c.input.ProjectionExpression))).toBe(true);
  expect(
    JSON.stringify(scans.map((c) => c.input.ExpressionAttributeNames)),
  ).not.toMatch(/"transcript"|"context"|"errors"/);
  expect(
    scans.every(
      (c) =>
        !String(c.input.ProjectionExpression)
          .split(",")
          .map((p) => p.trim())
          .includes("#notes"),
    ),
  ).toBe(true);
  expect(
    calls.every(
      (c) =>
        ![
          "update-service",
          "put-item",
          "update-item",
          "transact-write-items",
          "stop-task",
        ].includes(c.operation),
    ),
  ).toBe(true);
});
test("observer rejects an excessive window and mismatched identity before reading lifecycle data", async () => {
  let reads = 0;
  const aws = async () => {
    reads++;
    return { Account: "999999999999", Arn: "wrong" };
  };
  const args = {
    manifest,
    expectedSha256: manifestHash(manifest),
    aws,
    now: () => Date.parse("2026-10-16T10:00:00.000Z"),
  };
  await expect(
    collectSandboxObservation({
      ...args,
      since: "2026-10-14T10:00:00.000Z",
      until: "2026-10-16T10:00:00.000Z",
    }),
  ).rejects.toThrow();
  expect(reads).toBe(0);
  await expect(
    collectSandboxObservation({
      ...args,
      since: "2026-10-15T10:00:00.000Z",
      until: "2026-10-16T10:00:00.000Z",
    }),
  ).rejects.toThrow();
  expect(reads).toBe(1);
});
