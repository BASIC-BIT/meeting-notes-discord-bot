import { z } from "zod";
import type { MeetingHistory } from "./db";
import { MEETING_STATUS, type MeetingStatus } from "./meetingLifecycle";

const id = z.string().min(1);
const epochSecond = z.number().int().nonnegative();
const generation = z.number().int().nonnegative();
const identityFields = { instanceId: id, protocolVersion: z.literal(1) };
const runtimeModeSchema = z.enum(["bot", "api", "all"]);
export const runtimeIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({ ...identityFields, kind: z.literal("local"), localId: id })
    .strict(),
  z
    .object({
      ...identityFields,
      kind: z.literal("ecs"),
      taskArn: id,
      imageDigest: id,
      candidateId: id,
    })
    .strict(),
]);
export type RuntimeIdentity = z.infer<typeof runtimeIdentitySchema>;
export const runtimeReadinessSchema = z
  .object({
    identity: runtimeIdentitySchema,
    runtimeMode: runtimeModeSchema,
    observedEpoch: generation,
    observedGeneration: generation,
    gatewayReady: z.boolean(),
    cacheReady: z.boolean(),
    dependenciesReady: z.boolean(),
    provenAt: epochSecond,
    expiresAt: epochSecond,
  })
  .strict();
export type RuntimeReadiness = z.infer<typeof runtimeReadinessSchema>;
export const protectionConfirmationSchema = z
  .object({
    identity: runtimeIdentitySchema,
    provenAt: epochSecond,
    expiresAt: epochSecond,
  })
  .strict();
export type ProtectionConfirmation = z.infer<
  typeof protectionConfirmationSchema
>;
export const RUNTIME_WORK_KINDS = [
  "pending_admission",
  "recording",
  "finalization",
  "personal_processing",
  "recovery_processing",
  "voice_operation",
  "ancillary_delivery",
] as const;
export type RuntimeWorkKind = (typeof RUNTIME_WORK_KINDS)[number];
export type RuntimeWorkHandle = { settle(): void };
const runtimeMembersSchema = z
  .array(runtimeIdentitySchema)
  .max(98)
  .refine(
    (members) =>
      new Set(members.map((member) => member.instanceId)).size ===
      members.length,
    "Runtime members must be unique",
  );
export const controlRecordSchema = z
  .object({
    pk: z.literal("ENV"),
    sk: z.literal("CONTROL"),
    recordType: z.literal("control"),
    protocolVersion: z.literal(1),
    coordinatorToken: id,
    coordinatorEpoch: generation,
    coordinatorExpiresAt: epochSecond,
    servingGeneration: generation,
    servingMembers: z
      .record(z.string(), runtimeIdentitySchema)
      .refine(
        (members) =>
          Object.keys(members).length <= 98 &&
          Object.entries(members).every(
            ([instanceId, identity]) => instanceId === identity.instanceId,
          ),
        "Serving membership must bind instance keys to exact identities",
      ),
  })
  .strict();
export type ControlRecord = z.infer<typeof controlRecordSchema>;
export const runtimeRecordSchema = z
  .object({
    pk: z.literal("ENV"),
    sk: id,
    recordType: z.literal("runtime"),
    identity: runtimeIdentitySchema,
    role: z.enum(["candidate", "serving", "draining", "retired", "stale"]),
    authorizedGeneration: generation,
    heartbeatAt: epochSecond,
    readiness: runtimeReadinessSchema,
    protection: protectionConfirmationSchema,
    workCounts: z
      .record(z.enum(RUNTIME_WORK_KINDS), z.number().int().nonnegative())
      .optional(),
    expiresAt: epochSecond.optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.sk !== `RUNTIME#${row.identity.instanceId}`)
      ctx.addIssue({
        code: "custom",
        message: "Runtime key does not match identity",
      });
    if (
      !sameRuntimeIdentity(row.identity, row.readiness.identity) ||
      !sameRuntimeIdentity(row.identity, row.protection.identity)
    )
      ctx.addIssue({
        code: "custom",
        message: "Runtime proofs must bind to the exact identity",
      });
    if (row.expiresAt !== undefined && row.role !== "stale")
      ctx.addIssue({
        code: "custom",
        message: "Only stale runtime rows receive TTL",
      });
  });
export type RuntimeRecord = z.infer<typeof runtimeRecordSchema>;
export type RuntimeRoleTransition = {
  record: RuntimeRecord;
  expectedRole: RuntimeRecord["role"];
  expectedGeneration: number;
  retirementEpoch: number;
};
export function validateRuntimeRoleTransition(
  input: RuntimeRoleTransition,
): void {
  runtimeRecordSchema.parse(input.record);
  generation.parse(input.expectedGeneration);
  generation.parse(input.retirementEpoch);
  const legal =
    (input.record.role === "draining" &&
      ["candidate", "serving"].includes(input.expectedRole)) ||
    (input.record.role === "retired" && input.expectedRole === "draining") ||
    (input.record.role === "candidate" && input.expectedRole === "retired");
  if (!legal || input.record.authorizedGeneration !== input.expectedGeneration)
    throw new Error("Invalid runtime role transition");
}
export const voiceRecordSchema = z
  .object({
    pk: id,
    sk: z.literal("STATE"),
    recordType: z.literal("voice"),
    protocolVersion: z.literal(1),
    guildId: id,
    meetingId: id,
    ownerInstanceId: id,
    attemptId: id,
    state: z.enum([
      "joining",
      "connected",
      "disconnecting",
      "uncertain",
      "settled",
    ]),
    updatedAt: epochSecond,
  })
  .strict()
  .refine(
    (row) => row.pk === `VOICE#${row.guildId}`,
    "Voice key does not match guild",
  );
export type VoiceRecord = z.infer<typeof voiceRecordSchema>;
export const suppressionRecordSchema = z
  .object({
    pk: id,
    sk: id,
    recordType: z.literal("suppression"),
    protocolVersion: z.literal(1),
    guildId: id,
    channelId: id,
    meetingId: id,
    createdAt: epochSecond,
  })
  .strict()
  .refine(
    (row) =>
      row.pk === `SUPPRESS#${row.guildId}` &&
      row.sk === `CHANNEL#${row.channelId}`,
    "Suppression key does not match scope",
  );
export type SuppressionRecord = z.infer<typeof suppressionRecordSchema>;
export const deploymentControlRecordSchema = z.union([
  controlRecordSchema,
  runtimeRecordSchema,
  voiceRecordSchema,
  suppressionRecordSchema,
]);
export type DeploymentControlRecord = z.infer<
  typeof deploymentControlRecordSchema
>;
export const parseDeploymentControlRecord = (
  value: unknown,
): DeploymentControlRecord => deploymentControlRecordSchema.parse(value);

export function sameRuntimeIdentity(
  a: RuntimeIdentity,
  b: RuntimeIdentity,
): boolean {
  if (
    a.kind !== b.kind ||
    a.instanceId !== b.instanceId ||
    a.protocolVersion !== b.protocolVersion
  )
    return false;
  if (a.kind === "local" && b.kind === "local") return a.localId === b.localId;
  return (
    a.kind === "ecs" &&
    b.kind === "ecs" &&
    a.taskArn === b.taskArn &&
    a.imageDigest === b.imageDigest &&
    a.candidateId === b.candidateId
  );
}

export const admissionContextSchema = z
  .object({
    instanceId: id,
    identity: runtimeIdentitySchema,
    authorizedGeneration: generation,
    observedEpoch: generation,
    protocolVersion: z.literal(1),
    now: epochSecond,
  })
  .strict()
  .refine(
    (context) => context.instanceId === context.identity.instanceId,
    "Admission identity mismatch",
  );
export type AdmissionContext = z.infer<typeof admissionContextSchema>;
export type ControlTableNames = {
  deploymentControl: string;
  meetingHistory: string;
};
export const promotionInputSchema = z
  .object({
    coordinatorToken: id,
    coordinatorEpoch: generation,
    expectedServingGeneration: generation,
    candidate: runtimeIdentitySchema,
    candidateRuntimeMode: runtimeModeSchema,
    expectedServingMembers: runtimeMembersSchema,
    retainedMembers: runtimeMembersSchema.optional(),
    proposedGeneration: generation,
    now: epochSecond,
  })
  .strict()
  .refine(
    (input) => input.proposedGeneration > input.expectedServingGeneration,
    "Promotion generation must increase",
  )
  .refine((input) => {
    const retained = input.retainedMembers ?? [];
    return (
      retained.length < 98 &&
      !retained.some(
        (member) => member.instanceId === input.candidate.instanceId,
      ) &&
      retained.every((member) =>
        input.expectedServingMembers.some((expected) =>
          sameRuntimeIdentity(member, expected),
        ),
      )
    );
  }, "Retained runtimes must be selected existing members, distinct from the candidate");
export type PromotionInput = z.infer<typeof promotionInputSchema>;
export type AdmissionCheckResult =
  { kind: "admitted" } | { kind: "blocked"; reason: "not_serving" };
export type SessionReservation = {
  guildId: string;
  meetingId: string;
  ownerInstanceId: string;
  executionVersion: number;
  voiceOperationAttemptId: string;
  reservedAt: number;
  workHandle: RuntimeWorkHandle;
} & (
  | { sessionMode: "meeting"; historyKey: HistoryKey }
  | { sessionMode: "tts_only"; historyKey?: never }
);
export type SessionAdmissionResult =
  | { kind: "admitted"; reservation: SessionReservation }
  | {
      kind: "blocked";
      reason:
        | "active_session"
        | "not_serving"
        | "unavailable"
        | "voice_uncertain"
        | "suppressed";
    };
export type RetirementResult = {
  kind: "retired" | "busy" | "uncertain";
  counts: Partial<Record<RuntimeWorkKind, number>>;
  reason?: "work_remaining" | "voice_unsettled" | "dependency_unavailable";
};
export type HistoryKey = Pick<
  MeetingHistory,
  "guildId" | "channelId_timestamp"
>;
export const HISTORY_TRANSITION_FIELDS = [
  "status",
  "duration",
  "endReason",
  "endTriggeredByUserId",
  "cancellationReason",
  "processing",
  "delivery",
  "updatedAt",
  "transcriptS3Key",
  "audioS3Key",
  "chatS3Key",
] as const;
export type HistoryTransition = {
  key: HistoryKey;
  expectedMeetingId: string;
  expectedOwnerInstanceId: string;
  expectedExecutionVersion: number;
  expectedStatus: MeetingStatus;
  patch: Partial<
    Pick<MeetingHistory, (typeof HISTORY_TRANSITION_FIELDS)[number]>
  >;
};
const legalTransitions: Record<MeetingStatus, readonly MeetingStatus[]> = {
  starting: ["in_progress", "processing", "interrupted", "failed", "cancelled"],
  in_progress: ["processing", "interrupted", "failed", "cancelled"],
  processing: ["processing", "complete", "interrupted", "failed"],
  interrupted: ["processing", "failed"],
  failed: [],
  complete: [],
  cancelled: [],
};
export function validateHistoryTransition(input: HistoryTransition): void {
  id.parse(input.key.guildId);
  id.parse(input.key.channelId_timestamp);
  id.parse(input.expectedMeetingId);
  id.parse(input.expectedOwnerInstanceId);
  z.number().int().positive().parse(input.expectedExecutionVersion);
  z.enum(MEETING_STATUS).parse(input.expectedStatus);
  for (const key of Object.keys(input.patch)) {
    if (!HISTORY_TRANSITION_FIELDS.some((field) => field === key))
      throw new Error("History transition field is not allowed");
  }
  if (!Object.values(input.patch).some((value) => value !== undefined))
    throw new Error("History transition patch is empty");
  const target = input.patch.status;
  if (target && !legalTransitions[input.expectedStatus].includes(target))
    throw new Error("Illegal history status transition");
}
