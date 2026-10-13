/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as builders from "../../src/services/deploymentControlTransactions";
import * as types from "../../src/types/deploymentControl";
import {
  createCoordinator,
  candidateDefinition,
  runCli,
} from "../../scripts/deployment/coordinator.cjs";

const oldIdentity: types.RuntimeIdentity = {
  kind: "ecs",
  instanceId: "old",
  taskArn: "task:old",
  imageDigest: `sha256:${"b".repeat(64)}`,
  candidateId: "previous",
  protocolVersion: 1,
};
const candidateIdentity: types.RuntimeIdentity = {
  kind: "ecs",
  instanceId: "new",
  taskArn: "task:new",
  imageDigest: `sha256:${"a".repeat(64)}`,
  candidateId: "run-2",
  protocolVersion: 1,
};
const env = {
  SECRETS_PREFIX: "fixture",
  ECS_CLUSTER: "cluster",
  ECS_SERVICE: "service",
  ECS_TASK_FAMILY: "family",
  DEPLOYMENT_RUN_TOKEN: "run-2",
  DEPLOYMENT_CANDIDATE_ID: "run-2",
  CANDIDATE_IMAGE: `repo@${candidateIdentity.imageDigest}`,
};
const counts = (recording = 0) => ({
  pending_admission: 0,
  recording,
  finalization: 0,
  personal_processing: 0,
  recovery_processing: 0,
  voice_operation: 0,
  ancillary_delivery: 0,
});
function fixture() {
  let time = 1000;
  const ctl: types.ControlRecord = {
    pk: "ENV",
    sk: "CONTROL",
    recordType: "control",
    runtimeEnvironment: "ecs",
    protocolVersion: 1,
    coordinatorToken: "previous",
    coordinatorEpoch: 1,
    coordinatorExpiresAt: 0,
    servingGeneration: 1,
    servingMembers: { old: oldIdentity },
  };
  const row = (
    identity: types.RuntimeIdentity,
    role: types.RuntimeRecord["role"],
  ): types.RuntimeRecord => ({
    pk: "ENV",
    sk: `RUNTIME#${identity.instanceId}`,
    recordType: "runtime",
    identity,
    role,
    authorizedGeneration: 1,
    heartbeatAt: time,
    readiness: {
      identity,
      runtimeMode: "all",
      observedEpoch: 1,
      observedGeneration: 1,
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
      provenAt: time,
      expiresAt: time + 30,
    },
    protection: { identity, provenAt: time, expiresAt: time + 600 },
    workCounts: counts(role === "serving" ? 1 : 0),
  });
  const state = {
    ctl,
    rows: {
      old: row(oldIdentity, "serving"),
      new: row(candidateIdentity, "candidate"),
    },
    launched: false,
    protected: true,
    losePromotionResponse: false,
    loseUpdateResponse: false,
    retirementAcknowledged: false,
    onSleep: () => undefined,
  };
  const definition = {
    taskDefinitionArn: "definition:old",
    family: "family",
    revision: 1,
    taskRoleArn: "task-role",
    executionRoleArn: "execution-role",
    networkMode: "awsvpc",
    volumes: [{ name: "keep" }],
    containerDefinitions: [
      {
        name: "fixture",
        image: "repo:previous",
        environment: [{ name: "DDB_TABLE_PREFIX", value: "fixture-" }],
        secrets: [{ name: "EXAMPLE", valueFrom: "fixture-reference" }],
        logConfiguration: { logDriver: "awslogs" },
      },
    ],
  };
  const svc = {
    taskDefinition: "definition:old",
    desiredCount: 1,
    runningCount: 1,
    pendingCount: 0,
    deploymentController: { type: "ECS" },
    deploymentConfiguration: {
      alarms: { enable: true, rollback: true, alarmNames: ["fixture"] },
    },
    deployments: [{ rolloutState: "COMPLETED" }],
  };
  const calls: Array<{ operation: string; input: unknown }> = [];
  function refreshProofs() {
    for (const runtime of Object.values(state.rows)) {
      runtime.readiness.observedEpoch = state.ctl.coordinatorEpoch;
      runtime.readiness.observedGeneration = state.ctl.servingGeneration;
      runtime.readiness.expiresAt = time + 30;
      runtime.protection.expiresAt = time + 600;
    }
  }
  function promotion(input) {
    const controlUpdate = input.TransactItems[0].Update;
    const values = unmarshall(controlUpdate.ExpressionAttributeValues);
    if (
      values[":token"] !== state.ctl.coordinatorToken ||
      values[":epoch"] !== state.ctl.coordinatorEpoch ||
      values[":generation"] !== state.ctl.servingGeneration ||
      JSON.stringify(values[":expectedMembers"]) !==
        JSON.stringify(state.ctl.servingMembers)
    )
      throw new Error("conditional conflict");
    const runtimeValues = unmarshall(
      input.TransactItems[1].Update.ExpressionAttributeValues,
    );
    const selected = state.rows[runtimeValues[":identity"].instanceId];
    if (
      !selected.readiness.dependenciesReady ||
      !selected.readiness.gatewayReady ||
      selected.readiness.expiresAt <= time
    )
      throw new Error("not ready");
    state.ctl.servingGeneration = values[":next"];
    state.ctl.servingMembers = values[":members"];
    selected.role = "serving";
    selected.authorizedGeneration = values[":next"];
    selected.readiness.observedGeneration = values[":next"];
    if (state.losePromotionResponse) {
      state.losePromotionResponse = false;
      throw new Error("response lost after commit");
    }
  }
  function dynamo(operation, input) {
    switch (operation) {
      case "get-item": {
        const sk = unmarshall(input.Key).sk;
        const item = sk === "CONTROL" ? state.ctl : state.rows[sk.substring(8)];
        return { Item: item ? marshall(item) : undefined };
      }
      case "put-item": {
        const values = unmarshall(input.ExpressionAttributeValues);
        if (
          values[":token"] !== state.ctl.coordinatorToken ||
          values[":epoch"] !== state.ctl.coordinatorEpoch ||
          values[":generation"] !== state.ctl.servingGeneration
        )
          throw new Error("conditional conflict");
        state.ctl = unmarshall(input.Item) as types.ControlRecord;
        return {};
      }
      case "query":
        return {
          Items: Object.values(state.rows).map((runtime) => marshall(runtime)),
        };
      case "transact-write-items": {
        if (input.TransactItems[0].Update) promotion(input);
        else {
          const values = unmarshall(
            input.TransactItems[1].Update.ExpressionAttributeValues,
          );
          const runtime = state.rows[values[":identity"].instanceId];
          runtime.retirementRequest = values[":request"];
          if (state.retirementAcknowledged) {
            runtime.role = "retired";
            runtime.workCounts = counts();
            runtime.retirementAcknowledgment = {
              request: values[":request"],
              retiredAt: time,
            };
          }
        }
        return {};
      }
      default:
        throw new Error(`Unexpected AWS operation: ${operation}`);
    }
  }
  function ecs(operation, input) {
    switch (operation) {
      case "describe-services":
        return { services: [svc] };
      case "validate-update-service":
        return {};
      case "describe-task-definition":
        return { taskDefinition: definition };
      case "list-task-definitions":
        return { taskDefinitionArns: [] };
      case "register-task-definition":
        return {
          taskDefinition: { ...input, taskDefinitionArn: "definition:new" },
        };
      case "list-tasks":
        return {
          taskArns: state.launched ? ["task:old", "task:new"] : ["task:old"],
        };
      case "describe-tasks":
        return {
          tasks: input.tasks.map((arn) => ({
            taskArn: arn,
            taskDefinitionArn:
              arn === "task:old" ? "definition:old" : "definition:new",
            lastStatus: "RUNNING",
            containers: [
              {
                imageDigest:
                  arn === "task:old"
                    ? oldIdentity.imageDigest
                    : candidateIdentity.imageDigest,
              },
            ],
          })),
        };
      case "get-task-protection":
        return {
          protectedTasks: input.tasks.map((taskArn) => ({
            taskArn,
            protectionEnabled: state.protected,
            expirationDate: new Date((time + 600) * 1000).toISOString(),
          })),
        };
      case "update-service": {
        svc.taskDefinition = input.taskDefinition;
        svc.deploymentConfiguration = input.deploymentConfiguration;
        state.launched = true;
        refreshProofs();
        if (state.loseUpdateResponse) throw new Error("update response lost");
        return {};
      }
      default:
        throw new Error(`Unexpected ECS operation: ${operation}`);
    }
  }
  const aws = jest.fn(async (service, operation, input) => {
    calls.push({ operation, input });
    return service === "ecs" ? ecs(operation, input) : dynamo(operation, input);
  });
  const options = {
    env,
    aws,
    builders,
    types,
    now: () => time,
    sleep: async () => {
      time += 1000;
      refreshProofs();
      state.onSleep();
    },
  };
  const coordinator = createCoordinator(options);
  return { state, aws, calls, coordinator, definition, refreshProofs, options };
}

test("CLI reports unsupported capability before mutation without provider output", async () => {
  const f = fixture();
  const original = f.aws.getMockImplementation()!;
  f.aws.mockImplementation(async (service, operation, input) => {
    if (operation === "validate-update-service")
      throw new Error("RAW_PROVIDER_SECRET_AND_PAYLOAD");
    return original(service, operation, input);
  });
  const output = { log: jest.fn(), error: jest.fn() };
  expect(await runCli("prepare", f.options, output)).toBe(1);
  expect(JSON.parse(output.error.mock.calls[0][0])).toMatchObject({
    requestedPhase: "prepare",
    knownPhase: "none",
    operation: "ecs.validate-update-service",
    category: "cli_capability_unsupported",
    nativeProtection: "not_checked",
    taskAction: "no_stop_or_unprotect_requested",
  });
  expect(output.error.mock.calls[0][0]).not.toContain("RAW_PROVIDER");
  expect(output.error.mock.calls[0][0].length).toBeLessThan(512);
  expect(
    f.calls.some((call) =>
      ["put-item", "register-task-definition", "update-service"].includes(
        call.operation,
      ),
    ),
  ).toBe(false);
});

test("process CLI exits nonzero with bounded configuration diagnostics", () => {
  const child = spawnSync(
    process.execPath,
    [resolve("scripts/deployment/coordinator.cjs"), "prepare"],
    {
      env: { SECRETS_PREFIX: "PRIVATE/INVALID/PREFIX" },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stdout).toBe("");
  expect(JSON.parse(child.stderr)).toMatchObject({
    category: "configuration_invalid",
    operation: "configuration",
    knownPhase: "unknown",
    nativeProtection: "not_checked",
    taskAction: "no_stop_or_unprotect_requested",
  });
  expect(child.stderr).not.toContain("PRIVATE");
  expect(child.stderr.length).toBeLessThan(512);
});

test("CLI labels a positive native proof only as the last completed check", async () => {
  const f = fixture();
  const original = f.aws.getMockImplementation()!;
  f.aws.mockImplementation(async (service, operation, input) => {
    if (operation === "register-task-definition")
      throw new Error("PRIVATE_PROVIDER_DETAIL");
    return original(service, operation, input);
  });
  const output = { log: jest.fn(), error: jest.fn() };
  expect(await runCli("prepare", f.options, output)).toBe(1);
  expect(JSON.parse(output.error.mock.calls[0][0])).toMatchObject({
    knownPhase: "preparing",
    operation: "ecs.register-task-definition",
    category: "provider_operation_failed",
    nativeProtection: "last_check_confirmed",
    taskAction: "no_stop_or_unprotect_requested",
  });
  expect(output.error.mock.calls[0][0]).not.toContain(
    "PRIVATE_PROVIDER_DETAIL",
  );
  expect(f.calls.some((call) => call.operation === "update-service")).toBe(
    false,
  );
});

test("CLI reports rejected native protection truthfully without replacement writes", async () => {
  const f = fixture();
  f.state.protected = false;
  const output = { log: jest.fn(), error: jest.fn() };
  expect(await runCli("prepare", f.options, output)).toBe(1);
  expect(JSON.parse(output.error.mock.calls[0][0])).toMatchObject({
    requestedPhase: "prepare",
    knownPhase: "none",
    operation: "verify_native_protection",
    category: "native_protection_unconfirmed",
    nativeProtection: "unconfirmed",
    taskAction: "no_stop_or_unprotect_requested",
  });
  expect(output.error.mock.calls[0][0]).not.toContain(
    "Protected work is preserved",
  );
  expect(
    f.calls.some((call) =>
      [
        "put-item",
        "register-task-definition",
        "update-service",
        "stop-task",
        "update-task-protection",
      ].includes(call.operation),
    ),
  ).toBe(false);
});

test("CLI identifies a control-store failure without guessing availability or logging details", async () => {
  const f = fixture();
  f.aws.mockRejectedValue(new Error("PRIVATE_DATABASE_PAYLOAD"));
  const output = { log: jest.fn(), error: jest.fn() };
  expect(await runCli("prepare", f.options, output)).toBe(1);
  expect(JSON.parse(output.error.mock.calls[0][0])).toMatchObject({
    operation: "dynamodb.get-item",
    category: "control_store_operation_failed",
    knownPhase: "unknown",
    nativeProtection: "not_checked",
  });
  expect(output.error.mock.calls[0][0]).not.toContain(
    "PRIVATE_DATABASE_PAYLOAD",
  );
  expect(f.aws).toHaveBeenCalledTimes(1);
});

test("oldAdmissionStaysOpenDuringWarmup", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  expect(f.state.ctl.servingMembers).toEqual({ old: oldIdentity });
  expect(f.state.rows.old.role).toBe("serving");
  expect(f.state.rows.old.retirementRequest).toBeUndefined();
  expect(
    f.calls.findIndex((call) => call.operation === "get-task-protection"),
  ).toBeLessThan(
    f.calls.findIndex((call) => call.operation === "update-service"),
  );
});
test.each(["future_readiness", "future_protection"])(
  "prepare refuses an invalid old proof before mutation: %s",
  async (kind) => {
    const f = fixture();
    if (kind === "future_readiness") f.state.rows.old.readiness.provenAt = 2000;
    if (kind === "future_protection")
      f.state.rows.old.protection.provenAt = 2000;
    await expect(f.coordinator.prepare()).rejects.toThrow(
      "not a ready compatible",
    );
    expect(
      f.calls.some((call) =>
        ["put-item", "update-service", "register-task-definition"].includes(
          call.operation,
        ),
      ),
    ).toBe(false);
  },
);
test("deferredCleanupCapabilityIsValidatedBeforeMutationAndPreservesSettings", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  const validation = f.calls.findIndex(
    (call) => call.operation === "validate-update-service",
  );
  expect(validation).toBeLessThan(
    f.calls.findIndex((call) => call.operation === "put-item"),
  );
  const update = f.calls.find((call) => call.operation === "update-service");
  expect(update?.input).toMatchObject({
    deploymentConfiguration: {
      minimumHealthyPercent: 100,
      maximumPercent: 200,
      earlySuccessCriteria: {
        enable: true,
        healthyPercent: 100,
        sourceServiceRevisionCleanup: "DEFERRED",
      },
      alarms: { enable: true, rollback: true, alarmNames: ["fixture"] },
    },
  });
  expect(update?.input).not.toHaveProperty("desiredCount");
});
test("unsupportedRunnerCannotRequestReplacement", async () => {
  const f = fixture();
  const original = f.aws.getMockImplementation()!;
  f.aws.mockImplementation(async (service, operation, input) => {
    if (operation === "validate-update-service")
      throw new Error("unsupported CLI");
    return original(service, operation, input);
  });
  await expect(f.coordinator.prepare()).rejects.toMatchObject({
    category: "cli_capability_unsupported",
  });
  expect(
    f.calls.some((call) =>
      ["update-service", "register-task-definition", "put-item"].includes(
        call.operation,
      ),
    ),
  ).toBe(false);
});
test("candidateWithoutBotReadinessCannotPromote", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  f.state.rows.new.readiness.gatewayReady = false;
  await expect(f.coordinator.promote()).rejects.toThrow("readiness timeout");
  expect(f.state.ctl.servingGeneration).toBe(1);
});
test("failedWarmupDoesNotDrainOld", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  f.state.rows.new.readiness.dependenciesReady = false;
  await expect(f.coordinator.promote()).rejects.toThrow("readiness timeout");
  expect(await f.coordinator.reconcile()).toMatchObject({
    kind: "recovery_required",
  });
  expect(f.state.rows.old.retirementRequest).toBeUndefined();
  expect(f.state.rows.old.role).toBe("serving");
});
test("runnerLossReadsBackPromotion", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  f.state.losePromotionResponse = true;
  expect(await f.coordinator.promote()).toEqual({ kind: "promoted" });
  expect(f.state.ctl.servingMembers).toEqual({ new: candidateIdentity });
  expect(f.state.ctl.servingGeneration).toBe(2);
});
test("rollbackKeepsCandidateRecordingProtected", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  await f.coordinator.promote();
  f.refreshProofs();
  f.state.rows.new.workCounts = counts(1);
  expect(await f.coordinator.reconcile()).toMatchObject({
    kind: "rolled_back",
    candidatePreserved: true,
    recoveryRequired: true,
  });
  expect(f.state.ctl.servingGeneration).toBe(3);
  expect(f.state.rows.new.workCounts.recording).toBe(1);
  expect(f.state.rows.new.retirementRequest).toBeUndefined();
  expect(
    f.calls.some((call) =>
      ["stop-task", "update-task-protection"].includes(call.operation),
    ),
  ).toBe(false);
});
test("twoBusyProtectedTasksDoNotGetKilledForCapacity", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  f.state.protected = false;
  await expect(f.coordinator.promote()).rejects.toThrow("DEPLOYMENT_BLOCKED");
  expect(f.state.ctl.servingMembers).toEqual({ old: oldIdentity });
  expect(
    f.calls.some((call) =>
      ["stop-task", "update-task-protection"].includes(call.operation),
    ),
  ).toBe(false);
});
test("retirementRequiresExactRuntimeAckAndProviderConvergence", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  await f.coordinator.promote();
  f.state.retirementAcknowledged = true;
  expect(await f.coordinator.retire()).toEqual({ kind: "complete" });
  expect(f.state.rows.old.retirementAcknowledgment?.request).toMatchObject({
    coordinatorEpoch: 2,
    authorizedGeneration: 1,
    identity: oldIdentity,
  });
});
test("earlyProviderCompletionDoesNotHidePromotedApplicationFailure", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  await f.coordinator.promote();
  f.refreshProofs();
  f.state.rows.new.readiness.dependenciesReady = false;
  f.state.rows.new.workCounts = counts(1);
  await expect(f.coordinator.retire()).rejects.toThrow("readiness lost");
  expect(f.state.rows.old.retirementRequest).toBeUndefined();
  expect(await f.coordinator.reconcile()).toMatchObject({
    kind: "rolled_back",
  });
  expect(f.state.ctl.servingMembers).toEqual({ old: oldIdentity });
  expect(f.state.rows.new.workCounts.recording).toBe(1);
});
test("retirementWithoutAckPreservesProtectedBusyOwner", async () => {
  const f = fixture();
  await f.coordinator.prepare();
  await f.coordinator.promote();
  await expect(f.coordinator.retire()).rejects.toThrow("incomplete");
  expect(f.state.rows.old.workCounts.recording).toBe(1);
  expect(await f.coordinator.reconcile()).toMatchObject({
    kind: "recovery_required",
    phase: "retiring",
  });
});
test("ambiguousEcsUpdateIsReadBack", async () => {
  const f = fixture();
  f.state.loseUpdateResponse = true;
  expect(await f.coordinator.prepare()).toEqual({ kind: "warming" });
});
test("taskDefinitionPreservesFieldsAndPinsStopTimeoutAndIdentity", () => {
  const f = fixture();
  const result = candidateDefinition(f.definition, {
    tablePrefix: "fixture-",
    image: env.CANDIDATE_IMAGE,
    candidateId: "run-2",
  });
  expect(result.taskRoleArn).toBe("task-role");
  expect(result.volumes).toEqual(f.definition.volumes);
  expect(result.containerDefinitions[0].secrets).toEqual(
    f.definition.containerDefinitions[0].secrets,
  );
  expect(result.containerDefinitions[0].stopTimeout).toBe(120);
  expect(result.containerDefinitions[0].environment).toContainEqual({
    name: "DEPLOYMENT_CANDIDATE_ID",
    value: "run-2",
  });
  expect(result.taskDefinitionArn).toBeUndefined();
});

test("both workflows use the shared coordinator without lease scans or unconditional rollback", () => {
  for (const name of ["deploy.yml", "deploy-staging.yml"]) {
    const workflow = readFileSync(resolve(".github/workflows", name), "utf8");
    for (const phase of ["prepare", "promote", "retire", "reconcile"])
      expect(workflow).toContain(
        `node scripts/deployment/coordinator.cjs ${phase}`,
      );
    expect(workflow).not.toContain("Wait for active meetings to finish");
    expect(workflow).not.toContain("aws ecs update-service");
    expect(workflow).toContain("cancel-in-progress: false");
  }
});
