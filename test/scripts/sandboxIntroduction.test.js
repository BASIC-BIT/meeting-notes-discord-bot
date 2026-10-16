/** @jest-environment node */
import { expect, test, jest } from "@jest/globals";
import { randomUUID, createHash } from "node:crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  bindJob,
  prepare,
  createIntroduction,
} from "../../scripts/deployment/introduce-sandbox.cjs";
function fixture() {
  const account = "123456789012",
    prefix = "test-sandbox-";
  const role = "test-sandbox-github-deploy",
    operationId = randomUUID();
  const session =
    "chronote-sandbox-" + BigInt("0x" + operationId.replaceAll("-", "")) + "-1";
  const ecs = "arn:aws:ecs:us-east-1:" + account + ":";
  const elb = "arn:aws:elasticloadbalancing:us-east-1:" + account + ":";
  const m = {
    environment: "sandbox",
    accountId: account,
    region: "us-east-1",
    principalArn:
      "arn:aws:sts::" + account + ":assumed-role/" + role + "/" + session,
    operationId,
    sourceCommit: "a".repeat(40),
    tablePrefix: prefix,
    bucket: "test-sandbox-bucket",
    cluster: "test-sandbox-cluster",
    service: "test-sandbox-service",
    containerName: "test-sandbox-bot",
    containerPort: 3001,
    legacyTaskDefinition: ecs + "task-definition/test-sandbox-task:1",
    taskDefinition: ecs + "task-definition/test-sandbox-task:2",
    imageDigest: "sha256:" + "b".repeat(64),
    runtimeMode: "all",
    listenerArn: elb + "listener/app/test-sandbox/1/2",
    targetGroupA: elb + "targetgroup/test-sandbox-a/1",
    targetGroupB: elb + "targetgroup/test-sandbox-b/2",
    maintenance: {
      testOnly: true,
      workSettled: true,
      receiptSha256: "c".repeat(64),
      confirmedAt: new Date(1000000).toISOString(),
    },
  };
  const hash = createHash("sha256").update(JSON.stringify(m)).digest("hex");
  const env = {
    BOOTSTRAP_PHASE: "activate",
    BOOTSTRAP_MANIFEST_JSON: JSON.stringify(m),
    BOOTSTRAP_MANIFEST_SHA256: hash,
    BOOTSTRAP_OPERATION_ID: operationId,
    GITHUB_SHA: m.sourceCommit,
    GITHUB_RUN_ID: "12",
    GITHUB_RUN_ATTEMPT: "1",
    EXPECTED_ACCOUNT_ID: account,
    EXPECTED_ROLE_ARN: "arn:aws:iam::" + account + ":role/" + role,
  };
  const state = {
    stage: null,
    stopped: false,
    routed: false,
    launched: false,
    historyCount: 0,
    lostStop: false,
    lostRoute: false,
    foreignTasks: false,
  };
  const calls = [];
  const action = () =>
    state.routed
      ? [
          {
            Type: "forward",
            ForwardConfig: {
              TargetGroups: [
                { TargetGroupArn: m.targetGroupA, Weight: 100 },
                { TargetGroupArn: m.targetGroupB, Weight: 0 },
              ],
              TargetGroupStickinessConfig: { Enabled: false },
            },
          },
        ]
      : [
          {
            Type: "forward",
            TargetGroupArn: m.targetGroupA,
            ForwardConfig: {
              TargetGroups: [{ TargetGroupArn: m.targetGroupA, Weight: 1 }],
              TargetGroupStickinessConfig: { Enabled: false },
            },
          },
        ];
  const service = () => ({
    serviceName: m.service,
    desiredCount: state.stopped && !state.launched ? 0 : 1,
    runningCount: state.stopped && !state.launched ? 0 : 1,
    pendingCount: 0,
    taskDefinition: state.launched ? m.taskDefinition : m.legacyTaskDefinition,
    loadBalancers: [
      {
        targetGroupArn: m.targetGroupA,
        containerName: m.containerName,
        containerPort: m.containerPort,
      },
    ],
  });
  function scan(p) {
    if (!p.TableName.endsWith("DeploymentControlTable"))
      return {
        Count: p.TableName.endsWith("MeetingHistoryTable")
          ? state.historyCount
          : 0,
      };
    if (state.launched && p.Select !== "COUNT")
      return {
        Items: [
          marshall({
            recordType: "runtime",
            identity: { candidateId: m.operationId },
            role: state.serving ? "serving" : "candidate",
            readiness: {
              cacheReady: true,
              dependenciesReady: true,
              gatewayReady: true,
              observedGeneration: state.serving ? 1 : 0,
              provenAt: 1000,
              expiresAt: 2000,
            },
          }),
        ],
      };
    return {
      Items: state.stage ? [marshall(state.stage)] : [],
      Count: state.stage ? 1 : 0,
    };
  }
  const handlers = {
    sts: {
      "get-caller-identity": () => ({ Account: account, Arn: m.principalArn }),
    },
    dynamodb: {
      "transact-write-items": (p) => {
        if (state.stage) throw Error("exists");
        state.stage = unmarshall(p.TransactItems.find((x) => x.Put).Put.Item);
        return {};
      },
      "put-item": (p) => {
        if (state.stage) throw Error("exists");
        state.stage = unmarshall(p.Item);
        return {};
      },
      "update-item": (p) => {
        state.stage.stage = unmarshall(p.ExpressionAttributeValues)[":next"];
        return {};
      },
      "get-item": () => (state.stage ? { Item: marshall(state.stage) } : {}),
      scan,
    },
    ecs: {
      "describe-task-definition": () => ({
        taskDefinition: {
          taskDefinitionArn: m.taskDefinition,
          status: "ACTIVE",
          containerDefinitions: [
            {
              name: m.containerName,
              image:
                "123456789012.dkr.ecr.us-east-1.amazonaws.com/test-sandbox-repo@" +
                m.imageDigest,
              stopTimeout: 120,
              command: ["node", "dist/index.js"],
              environment: [
                { name: "TRANSCRIPTS_BUCKET", value: m.bucket },
                { name: "DDB_TABLE_PREFIX", value: m.tablePrefix },
                { name: "DEPLOYMENT_CANDIDATE_ID", value: m.operationId },
              ],
            },
          ],
        },
      }),
      "describe-services": () => ({ services: [service()], failures: [] }),
      "list-tasks": () => ({ taskArns: state.foreignTasks ? ["foreign"] : [] }),
      "describe-tasks": () => ({
        tasks: [{ lastStatus: "RUNNING" }],
        failures: [],
      }),
      "update-service": () => {
        expect(state.stage.stage).toBe("stop_submitted");
        if (state.lostStop) throw Error("ACK unknown");
        state.stopped = true;
        return { service: service() };
      },
    },
    elbv2: {
      "describe-listeners": () => ({
        Listeners: [
          {
            ListenerArn: m.listenerArn,
            Protocol: "HTTPS",
            DefaultActions: action(),
          },
        ],
      }),
      "describe-rules": () => ({ Rules: [{ IsDefault: true }] }),
      "describe-target-health": () => ({ TargetHealthDescriptions: [] }),
      "modify-listener": () => {
        expect(state.stage.stage).toBe("routing_submitted");
        if (state.lostRoute) throw Error("ACK unknown");
        state.routed = true;
        return {
          Listeners: [{ ListenerArn: m.listenerArn, DefaultActions: action() }],
        };
      },
    },
  };
  const aws = async (s, o, p) => {
    calls.push({ s, o, p });
    const handler = handlers[s]?.[o];
    if (!handler) throw Error("Unexpected " + s + "." + o);
    return handler(p);
  };
  const bootstrap = {
    initialize: jest.fn(async () => ({ kind: "initialized" })),
    launch: jest.fn(async () => {
      state.launched = true;
      return { kind: "launched" };
    }),
    promote: jest.fn(async () => {
      state.serving = true;
      return { kind: "complete", generation: 1 };
    }),
  };
  return { m, hash, env, state, calls, aws, bootstrap };
}
test("binds the reviewed operation session before execution", () => {
  const f = fixture();
  expect(bindJob(f.env).sessionName).toBe(f.m.principalArn.split("/").at(-1));
});
test.each([
  "GITHUB_SHA",
  "EXPECTED_ACCOUNT_ID",
  "EXPECTED_ROLE_ARN",
  "GITHUB_RUN_ATTEMPT",
])("rejects a foreign %s before binding", (key) => {
  const f = fixture();
  f.env[key] = key === "GITHUB_RUN_ATTEMPT" ? "2" : "foreign";
  expect(() => bindJob(f.env)).toThrow();
});
test("records intent before stop and routing and reuses guarded bootstrap", async () => {
  const f = fixture();
  await expect(
    createIntroduction({
      manifest: f.m,
      expectedSha256: f.hash,
      aws: f.aws,
      bootstrap: f.bootstrap,
      now: () => 1000,
      pause: async () => {},
    }).activate(),
  ).resolves.toEqual({ kind: "complete", generation: 1 });
  expect(f.bootstrap.initialize).toHaveBeenCalledTimes(1);
  expect(f.bootstrap.launch).toHaveBeenCalledTimes(1);
  expect(f.bootstrap.promote).toHaveBeenCalledTimes(1);
  expect(f.state.stage.stage).toBe("complete");
  expect(
    f.calls.some((c) =>
      ["stop-task", "update-task-protection", "delete-item"].includes(c.o),
    ),
  ).toBe(false);
});
test.each(["lostStop", "lostRoute"])(
  "does not replay an unknown provider write: %s",
  async (flag) => {
    const f = fixture();
    f.state[flag] = true;
    const intro = createIntroduction({
      manifest: f.m,
      expectedSha256: f.hash,
      aws: f.aws,
      bootstrap: f.bootstrap,
      now: () => 1000,
      pause: async () => {},
    });
    await expect(intro.activate()).rejects.toThrow();
    await expect(intro.activate()).rejects.toThrow();
    expect(f.calls.filter((c) => c.o === "update-service")).toHaveLength(1);
    expect(f.bootstrap.initialize).not.toHaveBeenCalled();
  },
);
test("unsettled history blocks every provider write", async () => {
  const f = fixture();
  f.state.historyCount = 1;
  await expect(
    createIntroduction({
      manifest: f.m,
      expectedSha256: f.hash,
      aws: f.aws,
      bootstrap: f.bootstrap,
      now: () => 1000,
      pause: async () => {},
    }).activate(),
  ).rejects.toThrow();
  expect(
    f.calls.some((c) =>
      ["put-item", "update-service", "modify-listener"].includes(c.o),
    ),
  ).toBe(false);
});
test("an invalid prepared candidate refuses before stopping legacy", async () => {
  const f = fixture();
  const aws = async (s, o, p) =>
    s === "ecs" && o === "describe-task-definition"
      ? { taskDefinition: { status: "INACTIVE" } }
      : f.aws(s, o, p);
  await expect(
    createIntroduction({
      manifest: f.m,
      expectedSha256: f.hash,
      aws,
      bootstrap: f.bootstrap,
      now: () => 1000,
      pause: async () => {},
    }).activate(),
  ).rejects.toThrow();
  expect(
    f.calls.some((c) =>
      ["transact-write-items", "update-service", "modify-listener"].includes(
        c.o,
      ),
    ),
  ).toBe(false);
});
test("activation requires the manifest operation to match the requested session", () => {
  const f = fixture();
  f.env.BOOTSTRAP_OPERATION_ID = randomUUID();
  expect(() => bindJob(f.env)).toThrow();
});
test("the existing identity workflow keeps its default read-only and gates bootstrap", () => {
  const workflow = parse(
    readFileSync(".github/workflows/sandbox-identity.yml", "utf8"),
  );
  expect(workflow.on.workflow_dispatch.inputs.bootstrap_phase.default).toBe(
    "none",
  );
  expect(workflow.jobs.bootstrap.environment).toBe("sandbox");
  expect(workflow.jobs.bootstrap.needs).toBe("identity");
  expect(workflow.jobs.bootstrap.if).toContain("!= 'none'");
  expect(
    workflow.jobs.bootstrap.steps.some((s) =>
      s.run?.includes("introduce-sandbox.cjs"),
    ),
  ).toBe(true);
  expect(workflow.jobs["denial-probe"].environment).toBeUndefined();
  expect(
    workflow.jobs["denial-probe"].steps.some(
      (s) => s.with?.["inline-session-policy"],
    ),
  ).toBe(true);
});

test("binding preserves the reviewed manifest serialization for its checksum", () => {
  const f = fixture();
  expect(
    createHash("sha256")
      .update(JSON.stringify(bindJob(f.env).manifest))
      .digest("hex"),
  ).toBe(f.hash);
});

function preparation() {
  const f = fixture(),
    family = "test-sandbox-task";
  const env = {
    ...f.env,
    BOOTSTRAP_PHASE: "prepare",
    AWS_REGION: "us-east-1",
    ECS_CLUSTER: f.m.cluster,
    ECS_SERVICE: f.m.service,
    ECS_TASK_FAMILY: family,
    SECRETS_PREFIX: "test-sandbox",
    CANDIDATE_IMAGE:
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/test-sandbox-repo@" +
      f.m.imageDigest,
  };
  const definition = {
    family,
    status: "ACTIVE",
    taskDefinitionArn: f.m.taskDefinition,
    taskRoleArn:
      "arn:aws:iam::123456789012:role/test-sandbox-ecs-task-app-role",
    executionRoleArn:
      "arn:aws:iam::123456789012:role/test-sandbox-ecs-task-exec-role",
    containerDefinitions: [
      {
        name: f.m.containerName,
        image: "legacy",
        command: ["npx", "yarn", "serve"],
        environment: [
          { name: "DDB_TABLE_PREFIX", value: f.m.tablePrefix },
          { name: "TRANSCRIPTS_BUCKET", value: f.m.bucket },
        ],
        secrets: [
          {
            name: "OPENAI_API_KEY",
            valueFrom:
              "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-sandbox/openai-abcdef",
          },
        ],
      },
    ],
  };
  const state = {
    root: false,
    foreignDigest: false,
    unknownRegistration: false,
    candidate: null,
    registrations: 0,
  };
  const aws = async (s, o, p) => {
    if (s === "sts")
      return {
        Account: f.m.accountId,
        Arn: state.root
          ? "arn:aws:iam::123456789012:root"
          : "arn:aws:sts::123456789012:assumed-role/test-sandbox-github-deploy/chronote-sandbox-12-1",
      };
    if (s === "ecr")
      return {
        imageDetails: [
          {
            imageDigest: state.foreignDigest
              ? "sha256:" + "d".repeat(64)
              : f.m.imageDigest,
            imageTags: [f.m.sourceCommit],
          },
        ],
      };
    if (o === "list-task-definitions")
      return { taskDefinitionArns: state.candidate ? ["candidate"] : [] };
    if (o === "describe-task-definition")
      return {
        taskDefinition:
          p.taskDefinition === "candidate" ? state.candidate : definition,
      };
    if (o === "register-task-definition") {
      state.registrations++;
      state.candidate = {
        ...p,
        status: "ACTIVE",
        taskDefinitionArn: "candidate",
      };
      if (state.unknownRegistration) throw Error("lost");
      return { taskDefinition: state.candidate };
    }
    throw Error("Unexpected preparation call");
  };
  return { f, env, state, aws };
}
test("preparation registers a pinned source and explicit Node launcher", async () => {
  const p = preparation();
  await expect(prepare(p.env, p.aws)).resolves.toEqual({ kind: "prepared" });
  expect(p.state.candidate.containerDefinitions[0]).toMatchObject({
    image: p.env.CANDIDATE_IMAGE,
    command: ["node", "dist/index.js"],
    stopTimeout: 120,
  });
});
test.each(["root", "foreignDigest"])(
  "preparation refuses %s without registration",
  async (flag) => {
    const p = preparation();
    p.state[flag] = true;
    await expect(prepare(p.env, p.aws)).rejects.toThrow();
    expect(p.state.registrations).toBe(0);
  },
);
test("unknown registration cannot be duplicated by a second preparation", async () => {
  const p = preparation();
  p.state.unknownRegistration = true;
  await expect(prepare(p.env, p.aws)).rejects.toThrow();
  await expect(prepare(p.env, p.aws)).rejects.toThrow();
  expect(p.state.registrations).toBe(1);
});
