import type {
  TransactWriteItem,
  TransactWriteItemsCommandInput,
  UpdateItemCommandInput,
  PutItemCommandInput,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { planLocalBootstrap } from "./runtimeLocalBootstrapPlan";
import type {
  MeetingHistory,
  PersonalMediaUploadJobRecord,
  PersonalMediaClaim,
  PersonalRecordingSegmentRecord,
} from "../types/db";
import {
  admissionContextSchema,
  promotionInputSchema,
  voiceRecordSchema,
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
  type SessionReservationInput,
  type WorkAdmissionAuthority,
} from "../types/deploymentControl";

export function buildPendingSegmentTransaction(
  segment: PersonalRecordingSegmentRecord,
  expectedStatus: "pending_upload" | "failed" | undefined,
  tables: { personalMediaUpload: string; personalRecordingSegment: string },
): TransactWriteItemsCommandInput {
  return {
    TransactItems: [
      {
        ConditionCheck: {
          TableName: tables.personalMediaUpload,
          Key: marshall({ uploadId: segment.uploadId }),
          ConditionExpression:
            "#status = :pending AND ownerUserId = :owner AND attribute_not_exists(processingClaimId)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":pending": "pending_upload",
            ":owner": segment.ownerUserId,
          }),
        },
      },
      {
        Put: {
          TableName: tables.personalRecordingSegment,
          Item: marshall(segment, { removeUndefinedValues: true }),
          ConditionExpression: expectedStatus
            ? "#status = :expected AND ownerUserId = :owner"
            : "attribute_not_exists(uploadId)",
          ...(expectedStatus
            ? {
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: marshall({
                  ":expected": expectedStatus,
                  ":owner": segment.ownerUserId,
                }),
              }
            : {}),
        },
      },
    ],
  };
}

export function buildWorkAdmissionChecks(
  authority: WorkAdmissionAuthority,
  tables: ControlTableNames,
): TransactWriteItem[] {
  if (authority.kind === "serving")
    return buildRuntimeAdmissionChecks(authority.context, tables);
  if (!tables.activeMeeting)
    throw new Error("Active meeting table is required");
  const owner = authority.ownership;
  return [
    {
      ConditionCheck: {
        TableName: tables.activeMeeting,
        Key: marshall({ guildId: owner.guildId }),
        ConditionExpression:
          "meetingId = :meeting AND ownerInstanceId = :owner AND executionVersion = :version AND voiceOperationAttemptId = :attempt AND leaseExpiresAt >= :now",
        ExpressionAttributeValues: marshall({
          ":meeting": owner.meetingId,
          ":owner": owner.ownerInstanceId,
          ":version": owner.executionVersion,
          ":attempt": owner.voiceOperationAttemptId,
          ":now": authority.now,
        }),
      },
    },
  ];
}

export function buildPersonalClaimCheck(
  claim: PersonalMediaClaim,
  table: string,
) {
  return {
    ConditionCheck: {
      TableName: table,
      Key: marshall({ uploadId: claim.uploadId }),
      ConditionExpression:
        "#status = :processing AND processingOwnerInstanceId = :owner AND attempts = :attempt AND processingClaimId = :claim AND claimExpiresAt >= :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: marshall({
        ":processing": "processing",
        ":owner": claim.instanceId,
        ":attempt": claim.attempt,
        ":claim": claim.claimId,
        ":now": claim.nowEpochSeconds,
      }),
    },
  };
}
export function buildPersonalMediaClaimTransaction(
  input: {
    job: PersonalMediaUploadJobRecord;
    context: AdmissionContext;
    expectedAttempts: number;
    maxAttempts: number;
    claimId: string;
  },
  tables: ControlTableNames & { personalMediaUpload: string },
): TransactWriteItemsCommandInput {
  if (
    input.job.processingOwnerInstanceId !== input.context.instanceId ||
    input.job.attempts !== input.expectedAttempts + 1 ||
    input.job.processingClaimId !== input.claimId ||
    input.expectedAttempts < 0 ||
    input.expectedAttempts >= input.maxAttempts
  )
    throw new Error("Personal claim identity mismatch");
  return {
    ClientRequestToken: input.claimId,
    TransactItems: [
      ...buildRuntimeAdmissionChecks(input.context, tables),
      {
        Put: {
          TableName: tables.personalMediaUpload,
          Item: marshall(input.job, { removeUndefinedValues: true }),
          ConditionExpression: `(#status = :queued OR (#status = :processing AND claimExpiresAt < :now)) AND ${input.expectedAttempts === 0 ? "(attribute_not_exists(attempts) OR attempts = :expected)" : "attempts = :expected"}`,
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":queued": "queued",
            ":processing": "processing",
            ":now": input.context.now,
            ":expected": input.expectedAttempts,
          }),
        },
      },
    ],
  };
}

function validateReservationIdentity({
  context,
  lease,
  voice,
}: SessionReservationInput): void {
  voiceRecordSchema.parse(voice);
  if (
    lease.voiceOperationAttemptId !== voice.attemptId ||
    lease.executionVersion !== voice.executionVersion ||
    lease.sessionMode !== voice.sessionMode
  )
    throw new Error("Reservation attempt identity mismatch");
  if (
    lease.guildId !== voice.guildId ||
    lease.meetingId !== voice.meetingId ||
    lease.ownerInstanceId !== context.instanceId ||
    voice.ownerInstanceId !== context.instanceId ||
    voice.state !== "joining" ||
    lease.executionVersion !== 1
  )
    throw new Error("Invalid session reservation");
}
function validateReservationHistory({
  lease,
  history,
}: SessionReservationInput): void {
  if (
    lease.sessionMode === "meeting"
      ? !history ||
        history.guildId !== lease.guildId ||
        history.meetingId !== lease.meetingId ||
        history.ownerInstanceId !== lease.ownerInstanceId ||
        history.executionVersion !== lease.executionVersion
      : Boolean(history)
  )
    throw new Error("Invalid reservation history");
}
export function buildSessionReservationTransaction(
  input: SessionReservationInput,
  tables: ControlTableNames,
): TransactWriteItemsCommandInput {
  const { context, lease, voice, history, suppression } = input;
  validateReservationIdentity(input);
  validateReservationHistory(input);
  if (!tables.activeMeeting)
    throw new Error("Active meeting table is required");
  const items: TransactWriteItem[] = [
    ...buildRuntimeAdmissionChecks(context, tables),
    {
      Put: {
        TableName: tables.activeMeeting,
        Item: marshall(lease, { removeUndefinedValues: true }),
        ConditionExpression:
          "attribute_not_exists(guildId) OR leaseExpiresAt < :now",
        ExpressionAttributeValues: marshall({ ":now": context.now }),
      },
    },
    {
      Put: {
        TableName: tables.deploymentControl,
        Item: marshall(voice),
        ConditionExpression: "attribute_not_exists(pk) OR #state = :settled",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: marshall({ ":settled": "settled" }),
      },
    },
  ];
  if (history)
    items.push({ Put: buildInitialMeetingHistoryPut(history, tables) });
  if (suppression)
    items.push({
      ConditionCheck: {
        TableName: tables.deploymentControl,
        Key: marshall({
          pk: `SUPPRESS#${lease.guildId}`,
          sk: `CHANNEL#${suppression.channelId}`,
        }),
        ConditionExpression:
          suppression.expectedVersion === undefined
            ? "attribute_not_exists(pk)"
            : "#version = :version AND #suppressed = :false",
        ...(suppression.expectedVersion === undefined
          ? {}
          : {
              ExpressionAttributeNames: {
                "#version": "version",
                "#suppressed": "suppressed",
              },
              ExpressionAttributeValues: marshall({
                ":version": suppression.expectedVersion,
                ":false": false,
              }),
            }),
      },
    });
  return { TransactItems: items, ClientRequestToken: input.requestToken };
}

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
