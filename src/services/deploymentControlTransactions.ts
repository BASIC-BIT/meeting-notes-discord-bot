import type {
  TransactWriteItem,
  TransactWriteItemsCommandInput,
  UpdateItemCommandInput,
  PutItemCommandInput,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { MeetingHistory } from "../types/db";
import {
  admissionContextSchema,
  promotionInputSchema,
  validateHistoryTransition,
  type AdmissionContext,
  type ControlTableNames,
  type HistoryTransition,
  type PromotionInput,
} from "../types/deploymentControl";

const runtimeProofCondition = [
  "#identity = readiness.#identity",
  "#identity = protection.#identity",
  "#identity.protocolVersion = :protocol",
  "readiness.observedEpoch = :epoch",
  "readiness.observedGeneration = :generation",
  "readiness.gatewayReady = :ready",
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
          "protocolVersion = :protocol AND servingGeneration = :generation AND servingInstanceId = :instance AND coordinatorEpoch = :epoch",
        ExpressionAttributeValues: marshall({
          ":protocol": context.protocolVersion,
          ":generation": context.authorizedGeneration,
          ":instance": context.instanceId,
          ":epoch": context.observedEpoch,
        }),
      },
    },
    {
      ConditionCheck: {
        TableName: tables.deploymentControl,
        Key: marshall({ pk: "ENV", sk: `RUNTIME#${context.instanceId}` }),
        ConditionExpression: `#role = :serving AND #identity.instanceId = :instance AND authorizedGeneration = :generation AND ${runtimeProofCondition}`,
        ExpressionAttributeNames: { "#role": "role", "#identity": "identity" },
        ExpressionAttributeValues: marshall({
          ":protocol": context.protocolVersion,
          ":generation": context.authorizedGeneration,
          ":instance": context.instanceId,
          ":epoch": context.observedEpoch,
          ":now": context.now,
          ":serving": "serving",
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
            "protocolVersion = :protocol AND coordinatorToken = :token AND coordinatorEpoch = :epoch AND coordinatorExpiresAt > :now AND servingGeneration = :generation",
          UpdateExpression:
            "SET servingGeneration = :next, servingInstanceId = :instance",
          ExpressionAttributeValues: marshall({
            ":protocol": 1,
            ":token": input.coordinatorToken,
            ":epoch": input.coordinatorEpoch,
            ":now": input.now,
            ":generation": input.expectedServingGeneration,
            ":next": input.proposedGeneration,
            ":instance": input.candidate.instanceId,
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
          ConditionExpression: `#role = :candidate AND #identity = :identity AND ${runtimeProofCondition}`,
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
            ":serving": "serving",
            ":ready": true,
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
