import type {
  TransactWriteItem,
  TransactWriteItemsCommandInput,
  UpdateItemCommandInput,
  PutItemCommandInput,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { planLocalBootstrap } from "./runtimeLocalBootstrapPlan";
import type { MeetingHistory } from "../types/db";
import {
  admissionContextSchema,
  promotionInputSchema,
  validateHistoryTransition,
  validateRuntimeRoleTransition,
  type RuntimeRoleTransition,
  type AdmissionContext,
  type ControlTableNames,
  type HistoryTransition,
  type PromotionInput,
  type LocalBootstrapInput,
  type ControlRecord,
  type RuntimeRecord,
} from "../types/deploymentControl";

/** Snapshot equality includes absent optional fields, so a renewed proof wins CAS. */
function snapshotCondition(record: ControlRecord | RuntimeRecord) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const fields = [
    ...new Set([
      ...Object.keys(record),
      ...(record.recordType === "runtime" ? ["expiresAt", "workCounts"] : []),
    ]),
  ].filter((key) => key !== "pk" && key !== "sk");
  const conditions = fields.map((field, index) => {
    const name = `#s${index}`;
    names[name] = field;
    const value = Object.entries(record).find(([key]) => key === field)?.[1];
    if (value === undefined) return `attribute_not_exists(${name})`;
    values[`:s${index}`] = value;
    return `${name} = :s${index}`;
  });
  return {
    ConditionExpression: conditions.join(" AND "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
  };
}

/** Local-only eligibility replacement; no lease, history or voice row is mutated. */
export function buildLocalBootstrapTransaction(
  input: LocalBootstrapInput,
  tables: ControlTableNames,
): TransactWriteItemsCommandInput {
  const next = planLocalBootstrap(input);
  const snapshots = [input.candidate, ...input.members];
  return {
    TransactItems: [
      {
        Put: {
          TableName: tables.deploymentControl,
          Item: marshall(next.control),
          ...snapshotCondition(input.control),
        },
      },
      ...snapshots.map((row) => {
        const authorized = next.authorized.find(
          (item) => item.identity.instanceId === row.identity.instanceId,
        );
        return authorized
          ? {
              Put: {
                TableName: tables.deploymentControl,
                Item: marshall(authorized, { removeUndefinedValues: true }),
                ...snapshotCondition(row),
              },
            }
          : {
              ConditionCheck: {
                TableName: tables.deploymentControl,
                Key: marshall({ pk: row.pk, sk: row.sk }),
                ...snapshotCondition(row),
              },
            };
      }),
    ],
  };
}

const runtimeProofCondition = [
  "#identity = readiness.#identity",
  "#identity = protection.#identity",
  "#identity.protocolVersion = :protocol",
  "readiness.observedGeneration = :generation",
  "(readiness.runtimeMode = :api OR readiness.gatewayReady = :ready)",
  "readiness.cacheReady = :ready",
  "readiness.dependenciesReady = :ready",
  "readiness.provenAt <= :now",
  "readiness.expiresAt > :now",
  "protection.provenAt <= :now",
  "protection.expiresAt > :now",
  "attribute_not_exists(expiresAt)",
].join(" AND ");

/** These checks must be in the same transaction as the work claim or reservation. */
export function buildRuntimeAdmissionChecks(
  context: AdmissionContext,
  tables: ControlTableNames,
): TransactWriteItem[] {
  admissionContextSchema.parse(context);
  return [
    {
      ConditionCheck: {
        TableName: tables.deploymentControl,
        Key: marshall({ pk: "ENV", sk: "CONTROL" }),
        ConditionExpression:
          "protocolVersion = :protocol AND servingGeneration = :generation AND servingMembers.#instance = :identity",
        ExpressionAttributeNames: { "#instance": context.instanceId },
        ExpressionAttributeValues: marshall({
          ":protocol": context.protocolVersion,
          ":generation": context.authorizedGeneration,
          ":identity": context.identity,
        }),
      },
    },
    {
      ConditionCheck: {
        TableName: tables.deploymentControl,
        Key: marshall({ pk: "ENV", sk: `RUNTIME#${context.instanceId}` }),
        ConditionExpression: `#role = :serving AND #identity = :identity AND authorizedGeneration = :generation AND ${runtimeProofCondition}`,
        ExpressionAttributeNames: { "#role": "role", "#identity": "identity" },
        ExpressionAttributeValues: marshall({
          ":protocol": context.protocolVersion,
          ":generation": context.authorizedGeneration,
          ":identity": context.identity,
          ":now": context.now,
          ":serving": "serving",
          ":api": "api",
          ":ready": true,
        }),
      },
    },
  ];
}

export function buildPromotionTransaction({
  tables,
  ...input
}: PromotionInput & {
  tables: ControlTableNames;
}): TransactWriteItemsCommandInput {
  promotionInputSchema.parse(input);
  return {
    TransactItems: [
      {
        Update: {
          TableName: tables.deploymentControl,
          Key: marshall({ pk: "ENV", sk: "CONTROL" }),
          ConditionExpression:
            "protocolVersion = :protocol AND runtimeEnvironment = :environment AND coordinatorToken = :token AND coordinatorEpoch = :epoch AND coordinatorExpiresAt > :now AND servingGeneration = :generation AND servingMembers = :expectedMembers",
          UpdateExpression:
            "SET servingGeneration = :next, servingMembers = :members",
          ExpressionAttributeValues: marshall({
            ":protocol": 1,
            ":environment": input.candidate.kind,
            ":token": input.coordinatorToken,
            ":epoch": input.coordinatorEpoch,
            ":now": input.now,
            ":generation": input.expectedServingGeneration,
            ":next": input.proposedGeneration,
            ":members": Object.fromEntries(
              [input.candidate, ...(input.retainedMembers ?? [])].map(
                (identity) => [identity.instanceId, identity],
              ),
            ),
            ":expectedMembers": Object.fromEntries(
              input.expectedServingMembers.map((identity) => [
                identity.instanceId,
                identity,
              ]),
            ),
          }),
        },
      },
      {
        Update: {
          TableName: tables.deploymentControl,
          Key: marshall({
            pk: "ENV",
            sk: `RUNTIME#${input.candidate.instanceId}`,
          }),
          ConditionExpression: `#role = :candidate AND #identity = :identity AND readiness.runtimeMode = :mode AND readiness.observedEpoch = :epoch AND ${runtimeProofCondition}`,
          UpdateExpression:
            "SET #role = :serving, authorizedGeneration = :next, readiness.observedGeneration = :next",
          ExpressionAttributeNames: {
            "#role": "role",
            "#identity": "identity",
          },
          ExpressionAttributeValues: marshall({
            ":protocol": 1,
            ":epoch": input.coordinatorEpoch,
            ":now": input.now,
            ":generation": input.expectedServingGeneration,
            ":next": input.proposedGeneration,
            ":identity": input.candidate,
            ":candidate": "candidate",
            ":api": "api",
            ":mode": input.candidateRuntimeMode,
            ":serving": "serving",
            ":ready": true,
          }),
        },
      },
      ...(input.retainedMembers ?? []).map((identity) => ({
        Update: {
          TableName: tables.deploymentControl,
          Key: marshall({ pk: "ENV", sk: `RUNTIME#${identity.instanceId}` }),
          ConditionExpression: `#role = :serving AND #identity = :identity AND authorizedGeneration = :generation AND readiness.observedEpoch = :epoch AND ${runtimeProofCondition}`,
          UpdateExpression:
            "SET authorizedGeneration = :next, readiness.observedGeneration = :next",
          ExpressionAttributeNames: {
            "#role": "role",
            "#identity": "identity",
          },
          ExpressionAttributeValues: marshall({
            ":serving": "serving",
            ":api": "api",
            ":identity": identity,
            ":generation": input.expectedServingGeneration,
            ":epoch": input.coordinatorEpoch,
            ":protocol": 1,
            ":now": input.now,
            ":ready": true,
            ":next": input.proposedGeneration,
          }),
        },
      })),
    ],
  };
}

/** Retirement and rearming are owned by this runtime, guarded against promotion. */
export function buildRuntimeRoleTransition(
  input: RuntimeRoleTransition,
  tables: ControlTableNames,
): TransactWriteItemsCommandInput {
  validateRuntimeRoleTransition(input);
  return {
    TransactItems: [
      {
        ConditionCheck: {
          TableName: tables.deploymentControl,
          Key: marshall({ pk: "ENV", sk: "CONTROL" }),
          ConditionExpression:
            "coordinatorEpoch = :epoch AND attribute_not_exists(servingMembers.#instance)",
          ExpressionAttributeNames: {
            "#instance": input.record.identity.instanceId,
          },
          ExpressionAttributeValues: marshall({
            ":epoch": input.retirementEpoch,
          }),
        },
      },
      {
        Put: {
          TableName: tables.deploymentControl,
          Item: marshall(input.record, { removeUndefinedValues: true }),
          ConditionExpression:
            "#identity = :identity AND #role = :role AND authorizedGeneration = :generation",
          ExpressionAttributeNames: {
            "#identity": "identity",
            "#role": "role",
          },
          ExpressionAttributeValues: marshall({
            ":identity": input.record.identity,
            ":role": input.expectedRole,
            ":generation": input.expectedGeneration,
          }),
        },
      },
    ],
  };
}

export function buildInitialMeetingHistoryPut(
  history: MeetingHistory,
  tables: ControlTableNames,
): PutItemCommandInput {
  if (
    !history.ownerInstanceId ||
    history.executionVersion !== 1 ||
    history.status !== "starting"
  )
    throw new Error(
      "Initial history requires starting status, owner and execution version 1",
    );
  return {
    TableName: tables.meetingHistory,
    Item: marshall(history, { removeUndefinedValues: true }),
    ConditionExpression:
      "attribute_not_exists(guildId) AND attribute_not_exists(channelId_timestamp)",
  };
}

export function buildHistoryTransition(
  input: HistoryTransition,
  tables: ControlTableNames,
): UpdateItemCommandInput {
  validateHistoryTransition(input);
  const names: Record<string, string> = { "#status": "status" };
  const values = marshall({
    ":meeting": input.expectedMeetingId,
    ":owner": input.expectedOwnerInstanceId,
    ":version": input.expectedExecutionVersion,
    ":prior": input.expectedStatus,
  });
  // The version fences the execution attempt shared with its lease. Only an
  // ownership/recovery transaction may advance it, never lifecycle progress.
  const updates: string[] = [];
  Object.entries(input.patch).forEach(([field, value], index) => {
    if (value === undefined) return;
    names[`#field${index}`] = field;
    Object.assign(
      values,
      marshall({ [`:value${index}`]: value }, { removeUndefinedValues: true }),
    );
    updates.push(`#field${index} = :value${index}`);
  });
  return {
    TableName: tables.meetingHistory,
    Key: marshall(input.key),
    ConditionExpression:
      "meetingId = :meeting AND ownerInstanceId = :owner AND executionVersion = :version AND #status = :prior",
    UpdateExpression: `SET ${updates.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}
