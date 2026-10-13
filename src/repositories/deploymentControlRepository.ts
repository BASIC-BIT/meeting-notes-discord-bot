import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import type { MeetingHistory } from "../types/db";
import {
  buildHistoryTransition,
  buildInitialMeetingHistoryPut,
  buildPromotionTransaction,
  buildRuntimeAdmissionChecks,
} from "../services/deploymentControlTransactions";
import {
  admissionContextSchema,
  controlRecordSchema,
  parseDeploymentControlRecord,
  promotionInputSchema,
  runtimeRecordSchema,
  sameRuntimeIdentity,
  voiceRecordSchema,
  type AdmissionCheckResult,
  type AdmissionContext,
  type ControlRecord,
  type ControlTableNames,
  type DeploymentControlRecord,
  type HistoryKey,
  type HistoryTransition,
  type PromotionInput,
  type RuntimeRecord,
  type VoiceRecord,
} from "../types/deploymentControl";

export type ConditionalResult = "applied" | "stale";
export type ExpectedVoiceState = Pick<
  VoiceRecord,
  "attemptId" | "state" | "ownerInstanceId" | "meetingId"
>;
const errorSchema = z.object({
  name: z.string().optional(),
  CancellationReasons: z
    .array(z.object({ Code: z.string().optional() }))
    .optional(),
});
export function classifyDeploymentTransactionError(
  error: unknown,
): "stale" | "conflict" | "unavailable" {
  const parsed = errorSchema.safeParse(error);
  if (!parsed.success) return "unavailable";
  const { name, CancellationReasons: reasons } = parsed.data;
  if (name === "ConditionalCheckFailedException") return "stale";
  if (name === "TransactionConflictException") return "conflict";
  if (name !== "TransactionCanceledException" || !reasons?.length)
    return "unavailable";
  if (
    reasons.some(
      (reason) =>
        !["None", "ConditionalCheckFailed", "TransactionConflict"].includes(
          reason.Code ?? "",
        ),
    )
  )
    return "unavailable";
  if (reasons.some((reason) => reason.Code === "TransactionConflict"))
    return "conflict";
  return reasons.some((reason) => reason.Code === "ConditionalCheckFailed")
    ? "stale"
    : "unavailable";
}
export class DeploymentControlError extends Error {
  constructor(
    public readonly kind: "conflict" | "unavailable",
    public readonly cause: unknown,
  ) {
    super(`Deployment control ${kind}`);
  }
}
async function conditional(
  operation: () => Promise<unknown>,
): Promise<ConditionalResult> {
  try {
    await operation();
    return "applied";
  } catch (error) {
    const kind = classifyDeploymentTransactionError(error);
    if (kind === "stale") return "stale";
    throw new DeploymentControlError(kind, error);
  }
}
export type DeploymentControlRepository = {
  getRecord(
    pk: string,
    sk: string,
  ): Promise<DeploymentControlRecord | undefined>;
  initializeControl(record: ControlRecord): Promise<ConditionalResult>;
  writeRuntime(record: RuntimeRecord): Promise<ConditionalResult>;
  writeVoice(
    record: VoiceRecord,
    expected?: ExpectedVoiceState,
  ): Promise<ConditionalResult>;
  /** Diagnostic only. Work claims must include buildRuntimeAdmissionChecks in their own transaction. */
  checkAdmission(context: AdmissionContext): Promise<AdmissionCheckResult>;
  promote(input: PromotionInput): Promise<ConditionalResult>;
  createInitialMeetingHistory(
    history: MeetingHistory,
  ): Promise<ConditionalResult>;
  transitionMeetingHistory(
    input: HistoryTransition,
  ): Promise<ConditionalResult>;
  getMeetingHistory(key: HistoryKey): Promise<MeetingHistory | undefined>;
};

export function createDynamoDeploymentControlRepository(
  client: DynamoDBClient,
  tables: ControlTableNames,
): DeploymentControlRepository {
  return {
    async getRecord(pk, sk) {
      const result = await client.send(
        new GetItemCommand({
          TableName: tables.deploymentControl,
          Key: marshall({ pk, sk }),
          ConsistentRead: true,
        }),
      );
      return result.Item
        ? parseDeploymentControlRecord(unmarshall(result.Item))
        : undefined;
    },
    initializeControl(record) {
      controlRecordSchema.parse(record);
      return conditional(() =>
        client.send(
          new PutItemCommand({
            TableName: tables.deploymentControl,
            Item: marshall(record),
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        ),
      );
    },
    writeRuntime(record) {
      runtimeRecordSchema.parse(record);
      return conditional(() =>
        client.send(
          new PutItemCommand({
            TableName: tables.deploymentControl,
            Item: marshall(record, { removeUndefinedValues: true }),
            ConditionExpression:
              "attribute_not_exists(pk) OR (#identity = :identity AND authorizedGeneration = :generation AND #role = :role)",
            ExpressionAttributeNames: {
              "#identity": "identity",
              "#role": "role",
            },
            ExpressionAttributeValues: marshall({
              ":identity": record.identity,
              ":generation": record.authorizedGeneration,
              ":role": record.role,
            }),
          }),
        ),
      );
    },
    async writeVoice(record, expected) {
      voiceRecordSchema.parse(record);
      if (
        expected &&
        expected.attemptId !== record.attemptId &&
        expected.state !== "settled"
      )
        return "stale";
      return conditional(() =>
        client.send(
          new PutItemCommand({
            TableName: tables.deploymentControl,
            Item: marshall(record),
            ConditionExpression: expected
              ? "attemptId = :attempt AND #state = :state AND ownerInstanceId = :owner AND meetingId = :meeting"
              : "attribute_not_exists(pk)",
            ...(expected
              ? {
                  ExpressionAttributeNames: { "#state": "state" },
                  ExpressionAttributeValues: marshall({
                    ":attempt": expected.attemptId,
                    ":state": expected.state,
                    ":owner": expected.ownerInstanceId,
                    ":meeting": expected.meetingId,
                  }),
                }
              : {}),
          }),
        ),
      );
    },
    async checkAdmission(context) {
      const result = await conditional(() =>
        client.send(
          new TransactWriteItemsCommand({
            TransactItems: buildRuntimeAdmissionChecks(context, tables),
          }),
        ),
      );
      return result === "applied"
        ? { kind: "admitted" }
        : { kind: "blocked", reason: "not_serving" };
    },
    promote: (input) =>
      conditional(() =>
        client.send(
          new TransactWriteItemsCommand(
            buildPromotionTransaction({ ...input, tables }),
          ),
        ),
      ),
    createInitialMeetingHistory: (history) =>
      conditional(() =>
        client.send(
          new PutItemCommand(buildInitialMeetingHistoryPut(history, tables)),
        ),
      ),
    transitionMeetingHistory: (input) =>
      conditional(() =>
        client.send(
          new UpdateItemCommand(buildHistoryTransition(input, tables)),
        ),
      ),
    async getMeetingHistory(key) {
      const result = await client.send(
        new GetItemCommand({
          TableName: tables.meetingHistory,
          Key: marshall(key),
          ConsistentRead: true,
        }),
      );
      return result.Item
        ? (unmarshall(result.Item) as MeetingHistory)
        : undefined;
    },
  };
}

function proofReady(
  row: RuntimeRecord,
  epoch: number,
  generation: number,
  now: number,
): boolean {
  return (
    row.readiness.observedEpoch === epoch &&
    row.readiness.observedGeneration === generation &&
    row.readiness.gatewayReady &&
    row.readiness.cacheReady &&
    row.readiness.dependenciesReady &&
    row.readiness.provenAt <= now &&
    row.readiness.expiresAt > now &&
    row.protection.provenAt <= now &&
    row.protection.expiresAt > now &&
    row.expiresAt === undefined
  );
}
export function createMockDeploymentControlRepository(
  records = new Map<string, DeploymentControlRecord>(),
  histories = new Map<string, MeetingHistory[]>(),
): DeploymentControlRepository {
  const recordKey = (pk: string, sk: string) => JSON.stringify([pk, sk]);
  const getControl = () => {
    const row = records.get(recordKey("ENV", "CONTROL"));
    return row?.recordType === "control" ? row : undefined;
  };
  const getRuntime = (instance: string) => {
    const row = records.get(recordKey("ENV", `RUNTIME#${instance}`));
    return row?.recordType === "runtime" ? row : undefined;
  };
  const getHistory = (key: HistoryKey) =>
    histories
      .get(key.guildId)
      ?.find((row) => row.channelId_timestamp === key.channelId_timestamp);
  const store = (record: DeploymentControlRecord): ConditionalResult => {
    records.set(recordKey(record.pk, record.sk), structuredClone(record));
    return "applied";
  };
  return {
    async getRecord(pk, sk) {
      const row = records.get(recordKey(pk, sk));
      return row ? structuredClone(row) : undefined;
    },
    async initializeControl(record) {
      controlRecordSchema.parse(record);
      return getControl() ? "stale" : store(record);
    },
    async writeRuntime(record) {
      runtimeRecordSchema.parse(record);
      const existing = getRuntime(record.identity.instanceId);
      if (
        existing &&
        (!sameRuntimeIdentity(existing.identity, record.identity) ||
          existing.authorizedGeneration !== record.authorizedGeneration ||
          existing.role !== record.role)
      )
        return "stale";
      return store(record);
    },
    async writeVoice(record, expected) {
      voiceRecordSchema.parse(record);
      if (
        expected &&
        expected.attemptId !== record.attemptId &&
        expected.state !== "settled"
      )
        return "stale";
      const existing = records.get(recordKey(record.pk, record.sk));
      if (
        expected
          ? existing?.recordType !== "voice" ||
            existing.attemptId !== expected.attemptId ||
            existing.state !== expected.state ||
            existing.ownerInstanceId !== expected.ownerInstanceId ||
            existing.meetingId !== expected.meetingId
          : Boolean(existing)
      )
        return "stale";
      return store(record);
    },
    async checkAdmission(context) {
      admissionContextSchema.parse(context);
      const control = getControl();
      const runtime = getRuntime(context.instanceId);
      return control &&
        runtime &&
        control.protocolVersion === context.protocolVersion &&
        control.servingInstanceId === context.instanceId &&
        control.servingGeneration === context.authorizedGeneration &&
        control.coordinatorEpoch === context.observedEpoch &&
        runtime.role === "serving" &&
        runtime.authorizedGeneration === context.authorizedGeneration &&
        proofReady(
          runtime,
          context.observedEpoch,
          context.authorizedGeneration,
          context.now,
        )
        ? { kind: "admitted" }
        : { kind: "blocked", reason: "not_serving" };
    },
    async promote(input) {
      promotionInputSchema.parse(input);
      const control = getControl();
      const candidate = getRuntime(input.candidate.instanceId);
      if (
        !control ||
        !candidate ||
        control.coordinatorEpoch !== input.coordinatorEpoch ||
        control.coordinatorToken !== input.coordinatorToken ||
        control.coordinatorExpiresAt <= input.now ||
        control.servingGeneration !== input.expectedServingGeneration ||
        candidate.role !== "candidate" ||
        !sameRuntimeIdentity(candidate.identity, input.candidate) ||
        !proofReady(
          candidate,
          input.coordinatorEpoch,
          input.expectedServingGeneration,
          input.now,
        )
      )
        return "stale";
      store({
        ...control,
        servingGeneration: input.proposedGeneration,
        servingInstanceId: input.candidate.instanceId,
      });
      store({
        ...candidate,
        role: "serving",
        authorizedGeneration: input.proposedGeneration,
        readiness: {
          ...candidate.readiness,
          observedGeneration: input.proposedGeneration,
        },
      });
      return "applied";
    },
    async createInitialMeetingHistory(history) {
      buildInitialMeetingHistoryPut(history, {
        deploymentControl: "mock",
        meetingHistory: "mock",
      });
      if (getHistory(history)) return "stale";
      histories.set(history.guildId, [
        ...(histories.get(history.guildId) ?? []),
        structuredClone(history),
      ]);
      return "applied";
    },
    async transitionMeetingHistory(input) {
      buildHistoryTransition(input, {
        deploymentControl: "mock",
        meetingHistory: "mock",
      });
      const row = getHistory(input.key);
      if (
        !row ||
        row.meetingId !== input.expectedMeetingId ||
        row.ownerInstanceId !== input.expectedOwnerInstanceId ||
        row.executionVersion !== input.expectedExecutionVersion ||
        row.status !== input.expectedStatus
      )
        return "stale";
      for (const [field, value] of Object.entries(input.patch))
        if (value !== undefined)
          Object.assign(row, { [field]: structuredClone(value) });
      return "applied";
    },
    async getMeetingHistory(key) {
      const row = getHistory(key);
      return row ? structuredClone(row) : undefined;
    },
  };
}
