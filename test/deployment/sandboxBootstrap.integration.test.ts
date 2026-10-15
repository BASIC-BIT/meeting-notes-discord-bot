import { randomUUID, createHash } from "node:crypto";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as builders from "../../src/services/deploymentControlTransactions";
import * as types from "../../src/types/deploymentControl";
import { createBootstrap } from "../../scripts/deployment/bootstrap-sandbox.cjs";

const client = new DynamoDBClient({
  endpoint: process.env.DEPLOYMENT_TEST_DYNAMODB_ENDPOINT,
  region: "local",
  credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
});
const created: string[] = [];
afterAll(async () => {
  for (const TableName of created)
    await client.send(new DeleteTableCommand({ TableName }));
  client.destroy();
});
async function fixture() {
  const account = "123456789012",
    region = "us-east-1";
  const prefix = `test-sandbox-${randomUUID()}-`;
  const table = `${prefix}DeploymentControlTable`;
  const leaseTable = `${prefix}ActiveMeetingTable`;
  for (const [TableName, keys] of [
    [table, ["pk", "sk"]],
    [leaseTable, ["guildId"]],
  ] as const) {
    await client.send(
      new CreateTableCommand({
        TableName,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: keys.map((AttributeName, index) => ({
          AttributeName,
          KeyType: index ? "RANGE" : "HASH",
        })),
        AttributeDefinitions: keys.map((AttributeName) => ({
          AttributeName,
          AttributeType: "S",
        })),
      }),
    );
    created.push(TableName);
  }
  const ecs = `arn:aws:ecs:${region}:${account}`;
  const elb = `arn:aws:elasticloadbalancing:${region}:${account}`;
  const manifest = {
    environment: "sandbox",
    accountId: account,
    region,
    principalArn: `arn:aws:iam::${account}:user/test-deployer`,
    operationId: randomUUID(),
    sourceCommit: "a".repeat(40),
    tablePrefix: prefix,
    bucket: "test-sandbox-bucket",
    cluster: "test-sandbox-cluster",
    service: "test-sandbox-service",
    legacyTaskDefinition: `${ecs}:task-definition/test-sandbox-task:1`,
    taskDefinition: `${ecs}:task-definition/test-sandbox-task:2`,
    imageDigest: `sha256:${"b".repeat(64)}`,
    containerName: "test-sandbox-bot",
    runtimeMode: "all",
    containerPort: 3001,
    listenerArn: `${elb}:listener/app/test-sandbox/1/2`,
    targetGroupA: `${elb}:targetgroup/test-sandbox-a/1`,
    targetGroupB: `${elb}:targetgroup/test-sandbox-b/2`,
    maintenance: {
      testOnly: true,
      workSettled: true,
      receiptSha256: "c".repeat(64),
      confirmedAt: new Date(1000 * 1000).toISOString(),
    },
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  const state = {
    desired: 0,
    running: false,
    nativeProtected: true,
    proofExpires: 2000,
    launchUnknown: false,
    transactionLost: false,
    updates: 0,
  };
  const taskArn = `${ecs}:task/test-sandbox-cluster/test-task`;
  const identity = {
    kind: "ecs",
    instanceId: "runtime",
    protocolVersion: 1,
    candidateId: manifest.operationId,
    imageDigest: manifest.imageDigest,
    taskArn,
  };
  const controlKey = { pk: "ENV", sk: "CONTROL" };
  async function get(sk: string) {
    const out = await client.send(
      new GetItemCommand({
        TableName: table,
        Key: marshall({ pk: "ENV", sk }),
        ConsistentRead: true,
      }),
    );
    return out.Item ? unmarshall(out.Item) : undefined;
  }
  async function aws(
    service: string,
    operation: string,
    input: Record<string, never>,
  ) {
    if (service === "dynamodb") {
      if (operation === "get-item")
        return client.send(new GetItemCommand(input));
      if (operation === "scan") return client.send(new ScanCommand(input));
      if (operation === "transact-write-items") {
        const result = await client.send(new TransactWriteItemsCommand(input));
        if (state.transactionLost) {
          state.transactionLost = false;
          throw new Error("ACK lost after apply");
        }
        return result;
      }
    }
    if (service === "sts")
      return { Account: account, Arn: manifest.principalArn };
    if (service === "ecs") {
      if (operation === "describe-services")
        return {
          failures: [],
          services: [
            {
              serviceName: manifest.service,
              taskDefinition: state.desired
                ? manifest.taskDefinition
                : manifest.legacyTaskDefinition,
              desiredCount: state.desired,
              runningCount: state.running ? 1 : 0,
              pendingCount: 0,
              loadBalancers: [
                {
                  targetGroupArn: manifest.targetGroupA,
                  containerName: manifest.containerName,
                  containerPort: 3001,
                },
              ],
            },
          ],
        };
      if (operation === "list-tasks")
        return { taskArns: state.running ? [taskArn] : [] };
      if (operation === "describe-tasks")
        return {
          failures: [],
          tasks: state.running
            ? [
                {
                  taskArn,
                  taskDefinitionArn: manifest.taskDefinition,
                  lastStatus: "RUNNING",
                  containers: [
                    {
                      name: manifest.containerName,
                      imageDigest: manifest.imageDigest,
                      networkInterfaces: [{ privateIpv4Address: "10.0.0.1" }],
                    },
                  ],
                },
              ]
            : [],
        };
      if (operation === "describe-task-definition")
        return {
          taskDefinition: {
            taskDefinitionArn: manifest.taskDefinition,
            containerDefinitions: [
              {
                name: manifest.containerName,
                image: `test.invalid/sandbox@${manifest.imageDigest}`,
                command: ["node", "dist/index.js"],
                stopTimeout: 120,
                environment: [
                  { name: "DDB_TABLE_PREFIX", value: prefix },
                  { name: "TRANSCRIPTS_BUCKET", value: manifest.bucket },
                  {
                    name: "DEPLOYMENT_CANDIDATE_ID",
                    value: manifest.operationId,
                  },
                ],
              },
            ],
          },
        };
      if (operation === "get-task-protection")
        return {
          failures: [],
          protectedTasks: [
            {
              taskArn,
              protectionEnabled: state.nativeProtected,
              expirationDate: new Date(state.proofExpires * 1000).toISOString(),
            },
          ],
        };
      if (operation === "update-service") {
        state.updates++;
        state.desired = 1;
        state.running = true;
        const ctl = await get("CONTROL");
        await client.send(
          new PutItemCommand({
            TableName: table,
            Item: marshall({
              pk: "ENV",
              sk: "RUNTIME#runtime",
              recordType: "runtime",
              identity,
              role: "candidate",
              authorizedGeneration: 0,
              heartbeatAt: 1000,
              readiness: {
                identity,
                runtimeMode: "all",
                observedEpoch: ctl!.coordinatorEpoch,
                observedGeneration: 0,
                gatewayReady: true,
                cacheReady: true,
                dependenciesReady: true,
                provenAt: 1000,
                expiresAt: 1030,
              },
              protection: { identity, provenAt: 1000, expiresAt: 2000 },
              workCounts: {
                pending_admission: 0,
                recording: 0,
                finalization: 0,
                personal_processing: 0,
                recovery_processing: 0,
                voice_operation: 0,
                ancillary_delivery: 0,
              },
            }),
          }),
        );
        if (state.launchUnknown) throw new Error("UpdateService response lost");
        return { service: { taskDefinition: manifest.taskDefinition } };
      }
    }
    if (service === "elbv2") {
      if (operation === "describe-listeners")
        return {
          Listeners: [
            {
              ListenerArn: manifest.listenerArn,
              Protocol: "HTTPS",
              LoadBalancerArn: "lb",
              DefaultActions: [
                {
                  Type: "forward",
                  ForwardConfig: {
                    TargetGroups: [
                      { TargetGroupArn: manifest.targetGroupA, Weight: 100 },
                      { TargetGroupArn: manifest.targetGroupB, Weight: 0 },
                    ],
                    TargetGroupStickinessConfig: { Enabled: false },
                  },
                },
              ],
            },
          ],
        };
      if (operation === "describe-rules")
        return { Rules: [{ IsDefault: true }] };
      if (operation === "describe-target-groups")
        return {
          TargetGroups: [manifest.targetGroupA, manifest.targetGroupB].map(
            (TargetGroupArn) => ({
              TargetGroupArn,
              TargetType: "ip",
              Protocol: "HTTP",
              Port: 3001,
              VpcId: "sandbox-vpc",
              HealthCheckPath: "/health",
              LoadBalancerArns: ["lb"],
            }),
          ),
        };
      if (operation === "describe-target-group-attributes")
        return { Attributes: [{ Key: "stickiness.enabled", Value: "false" }] };
      if (operation === "describe-target-health") {
        const group = (input as Record<string, unknown>).TargetGroupArn;
        return {
          TargetHealthDescriptions:
            state.running && group === manifest.targetGroupA
              ? [
                  {
                    Target: { Id: "10.0.0.1", Port: 3001 },
                    TargetHealth: { State: "healthy" },
                  },
                ]
              : [],
        };
      }
    }
    throw new Error(`Unexpected ${service}.${operation}`);
  }
  const bootstrap = createBootstrap({
    manifest,
    expectedSha256: hash,
    aws,
    builders,
    types,
    now: () => 1000,
  });
  return {
    manifest,
    hash,
    state,
    bootstrap,
    get,
    table,
    leaseTable,
    controlKey,
    aws,
  };
}
test("cold bootstrap uses real conditional writes, self registration and promotion; restart does not launch twice", async () => {
  const f = await fixture();
  await f.bootstrap.initialize();
  await f.bootstrap.initialize();
  expect((await f.get("CONTROL"))?.servingMembers).toEqual({});
  await f.bootstrap.launch();
  await f.bootstrap.launch();
  await f.bootstrap.promote();
  await f.bootstrap.promote();
  expect(f.state.updates).toBe(1);
  expect(await f.get("CONTROL")).toMatchObject({
    servingGeneration: 1,
    coordinatorExpiresAt: 0,
  });
  expect(await f.get("RUNTIME#runtime")).toMatchObject({
    role: "serving",
    authorizedGeneration: 1,
  });
});
test("live legacy tasks and nonterminal leases refuse initialization without touching Control", async () => {
  const f = await fixture();
  f.state.running = true;
  await expect(f.bootstrap.initialize()).rejects.toThrow();
  expect(await f.get("CONTROL")).toBeUndefined();
  f.state.running = false;
  await client.send(
    new PutItemCommand({
      TableName: f.leaseTable,
      Item: marshall({
        guildId: "fixture",
        status: "in_progress",
        leaseExpiresAt: 900,
      }),
    }),
  );
  await expect(f.bootstrap.initialize()).rejects.toThrow();
  expect(await f.get("CONTROL")).toBeUndefined();
});
test("checksum and identity mismatch refuse all mutations", async () => {
  const f = await fixture();
  expect(() =>
    createBootstrap({
      manifest: f.manifest,
      expectedSha256: "0".repeat(64),
      aws: f.aws,
      builders,
      types,
      now: () => 1000,
    }),
  ).toThrow();
  const wrong = async (s: string, o: string, i: Record<string, never>) =>
    s === "sts"
      ? { Account: "999999999999", Arn: f.manifest.principalArn }
      : f.aws(s, o, i);
  await expect(
    createBootstrap({
      manifest: f.manifest,
      expectedSha256: f.hash,
      aws: wrong,
      builders,
      types,
      now: () => 1000,
    }).initialize(),
  ).rejects.toThrow();
  expect(await f.get("CONTROL")).toBeUndefined();
});
test("concurrent operators cannot overwrite Control", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    f.bootstrap.initialize(),
    f.bootstrap.initialize(),
  ]);
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  expect(await f.get("CONTROL")).toMatchObject({
    coordinatorToken: f.manifest.operationId,
  });
  await client.send(
    new PutItemCommand({
      TableName: f.table,
      Item: marshall({
        ...(await f.get("CONTROL")),
        coordinatorToken: "foreign",
      }),
    }),
  );
  await expect(f.bootstrap.initialize()).rejects.toThrow();
});
test("lost Dynamo acknowledgment reconciles exact receipt without resubmission", async () => {
  const f = await fixture();
  f.state.transactionLost = true;
  await f.bootstrap.initialize();
  await f.bootstrap.launch();
  f.state.transactionLost = true;
  await f.bootstrap.promote();
  expect(await f.get("CONTROL")).toMatchObject({ servingGeneration: 1 });
});
test("unknown UpdateService outcome never replays or permits promotion despite matching readback", async () => {
  const f = await fixture();
  await f.bootstrap.initialize();
  f.state.launchUnknown = true;
  await expect(f.bootstrap.launch()).rejects.toThrow();
  await expect(f.bootstrap.launch()).rejects.toThrow();
  await expect(f.bootstrap.promote()).rejects.toThrow();
  expect(f.state.updates).toBe(1);
  expect((await f.get("CONTROL"))?.servingGeneration).toBe(0);
});
test("stale readiness or insufficient native protection refuses promotion", async () => {
  const f = await fixture();
  await f.bootstrap.initialize();
  await f.bootstrap.launch();
  f.state.nativeProtected = false;
  await expect(f.bootstrap.promote()).rejects.toThrow();
  f.state.nativeProtected = true;
  f.state.proofExpires = 1100;
  await expect(f.bootstrap.promote()).rejects.toThrow();
  const row = (await f.get("RUNTIME#runtime"))!;
  row.readiness.expiresAt = 999;
  f.state.proofExpires = 2000;
  await client.send(
    new PutItemCommand({ TableName: f.table, Item: marshall(row) }),
  );
  await expect(f.bootstrap.promote()).rejects.toThrow();
  expect((await f.get("CONTROL"))?.servingGeneration).toBe(0);
});

test("concurrent launch attempts dispatch UpdateService only once", async () => {
  const f = await fixture();
  await f.bootstrap.initialize();
  const results = await Promise.allSettled([
    f.bootstrap.launch(),
    f.bootstrap.launch(),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.state.updates).toBe(1);
});
test("missing candidate work accounting refuses promotion", async () => {
  const f = await fixture();
  await f.bootstrap.initialize();
  await f.bootstrap.launch();
  const row = (await f.get("RUNTIME#runtime"))!;
  delete row.workCounts;
  await client.send(
    new PutItemCommand({ TableName: f.table, Item: marshall(row) }),
  );
  await expect(f.bootstrap.promote()).rejects.toThrow();
  expect((await f.get("CONTROL"))?.servingGeneration).toBe(0);
});

test.each(["wrong", "missing", "duplicate", "secret"] as const)(
  "prepared %s recording bucket refuses launch before external mutation",
  async (mode) => {
    const f = await fixture();
    await f.bootstrap.initialize();
    const aws = async (
      service: string,
      operation: string,
      input: Record<string, never>,
    ) => {
      const result = await f.aws(service, operation, input);
      if (
        service === "ecs" &&
        operation === "describe-task-definition" &&
        "taskDefinition" in result &&
        result.taskDefinition
      ) {
        const definition = result;
        const container = definition.taskDefinition.containerDefinitions[0];
        container.environment = container.environment.filter(
          (e) => e.name !== "TRANSCRIPTS_BUCKET",
        );
        if (mode === "wrong")
          container.environment.push({
            name: "TRANSCRIPTS_BUCKET",
            value: "different-bucket",
          });
        if (mode === "duplicate")
          container.environment.push(
            ...[1, 2].map(() => ({
              name: "TRANSCRIPTS_BUCKET",
              value: f.manifest.bucket,
            })),
          );
        if (mode === "secret")
          return {
            ...definition,
            taskDefinition: {
              ...definition.taskDefinition,
              containerDefinitions: [
                {
                  ...container,
                  secrets: [
                    {
                      name: "TRANSCRIPTS_BUCKET",
                      valueFrom: "ambiguous-secret",
                    },
                  ],
                },
              ],
            },
          };
      }
      return result;
    };
    const bootstrap = createBootstrap({
      manifest: f.manifest,
      expectedSha256: f.hash,
      aws,
      builders,
      types,
      now: () => 1000,
    });
    await expect(bootstrap.launch()).rejects.toThrow();
    expect(f.state.updates).toBe(0);
  },
);

test("changed empty service definition refuses launch instead of overriding another operation", async () => {
  const f = await fixture();
  await f.bootstrap.initialize();
  const aws = async (
    service: string,
    operation: string,
    input: Record<string, never>,
  ) => {
    const result = await f.aws(service, operation, input);
    if (
      service === "ecs" &&
      operation === "describe-services" &&
      "services" in result &&
      result.services
    )
      result.services[0].taskDefinition = f.manifest.taskDefinition;
    return result;
  };
  const bootstrap = createBootstrap({
    manifest: f.manifest,
    expectedSha256: f.hash,
    aws,
    builders,
    types,
    now: () => 1000,
  });
  await expect(bootstrap.launch()).rejects.toThrow();
  expect(f.state.updates).toBe(0);
});
