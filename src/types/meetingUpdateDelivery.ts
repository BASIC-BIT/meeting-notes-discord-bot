import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { MeetingHistory } from "./db";

export const MEETING_UPDATE_DELIVERY_QUEUE = "meeting-update:v1";
export const MEETING_UPDATE_DELIVERY_DUE_INDEX = "UpdateDeliveryDueIndex";
const id = z.string().min(1).max(512);
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revisionNumber = seconds;
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

export type MeetingUpdateKey = Pick<
  MeetingHistory,
  "guildId" | "channelId_timestamp"
>;
export const presentationPartSchema = z.enum([
  "notesBody",
  "notesTitle",
  "notesWarning",
  "summaryBody",
  "summaryTitle",
  "summaryWarning",
]);
export type PresentationPart = z.infer<typeof presentationPartSchema>;
const watermarkSchema = z
  .object({ desired: revisionNumber, acknowledged: revisionNumber })
  .strict()
  .refine((part) => part.acknowledged <= part.desired);
export const partWatermarksSchema = z.record(
  presentationPartSchema,
  watermarkSchema,
);
export type PartWatermarks = z.infer<typeof partWatermarksSchema>;

export const notesPointersSchema = z
  .object({
    notesChannelId: id.nullable(),
    notesMessageIds: z.array(id).max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.notesMessageIds).size === value.notesMessageIds.length &&
      (value.notesChannelId !== null || value.notesMessageIds.length === 0),
  );
export type NotesPointers = z.infer<typeof notesPointersSchema>;

const notesMutation = z
  .object({
    kind: z.literal("notes"),
    notes: z.string(),
    notesDelta: z.unknown().optional(),
  })
  .strict();
const renameMutation = z
  .object({ kind: z.literal("rename"), meetingName: z.string().min(1) })
  .strict();
const contentChange = z.discriminatedUnion("kind", [
  notesMutation,
  renameMutation,
  z.object({ kind: z.literal("summarySentence"), value: z.string() }).strict(),
  z.object({ kind: z.literal("summaryLabel"), value: z.string() }).strict(),
]);
export const meetingUpdateMutationSchema = z.discriminatedUnion("kind", [
  notesMutation,
  renameMutation,
  z
    .object({
      kind: z.literal("correction"),
      changes: z
        .array(contentChange)
        .min(1)
        .max(4)
        .refine(
          (changes) =>
            new Set(changes.map((c) => c.kind)).size === changes.length,
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("warning"),
      target: z.enum(["notes", "summary", "both"]),
    })
    .strict(),
]);
export type MeetingUpdateMutation = z.infer<typeof meetingUpdateMutationSchema>;

export function requestedPartsForMutation(
  mutation: MeetingUpdateMutation,
): PresentationPart[] {
  const parsed = meetingUpdateMutationSchema.parse(mutation);
  switch (parsed.kind) {
    case "notes":
      return ["notesBody"];
    case "rename":
      return ["notesTitle", "summaryTitle"];
    case "warning":
      return parsed.target === "both"
        ? ["notesWarning", "summaryWarning"]
        : parsed.target === "notes"
          ? ["notesWarning"]
          : ["summaryWarning"];
    case "correction":
      return presentationPartSchema.options.filter((part) =>
        parsed.changes.some((change) =>
          partsForContentChange(change).includes(part),
        ),
      );
    default: {
      const exhaustive: never = parsed;
      return exhaustive;
    }
  }
}

function partsForContentChange(
  change: z.infer<typeof contentChange>,
): PresentationPart[] {
  if (change.kind === "summarySentence" || change.kind === "summaryLabel")
    return ["summaryBody"];
  return requestedPartsForMutation(change);
}

const operationBase = z.object({ operationId: id });
const messageTarget = operationBase.extend({ channelId: id, messageId: id });
const slot = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), messageId: id }).strict(),
  z.object({ kind: z.literal("created"), operationId: id }).strict(),
]);
export const meetingUpdateProviderOperationSchema = z.discriminatedUnion(
  "kind",
  [
    messageTarget
      .extend({
        kind: z.literal("patch"),
        beforeFingerprint: fingerprint,
        desiredFingerprint: fingerprint,
      })
      .strict(),
    operationBase
      .extend({
        kind: z.literal("post"),
        channelId: id,
        desiredFingerprint: fingerprint,
      })
      .strict(),
    operationBase
      .extend({
        kind: z.literal("register"),
        expectedPointers: notesPointersSchema,
        notesChannelId: id,
        slots: z.array(slot).min(1).max(100),
      })
      .strict(),
    messageTarget
      .extend({ kind: z.literal("delete"), beforeFingerprint: fingerprint })
      .strict(),
  ],
);
export type MeetingUpdateProviderOperation = z.infer<
  typeof meetingUpdateProviderOperationSchema
>;
export const preparedMeetingUpdateAttemptSchema = z
  .object({
    attemptId: id,
    contentRevision: revisionNumber.positive(),
    capturedParts: z
      .partialRecord(presentationPartSchema, revisionNumber.positive())
      .refine((parts) => Object.keys(parts).length > 0),
    expectedPointers: notesPointersSchema,
    operations: z.array(meetingUpdateProviderOperationSchema).min(1).max(300),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (
      Object.values(attempt.capturedParts).some(
        (revision) => revision > attempt.contentRevision,
      ) ||
      new Set(attempt.operations.map((op) => op.operationId)).size !==
        attempt.operations.length
    )
      context.addIssue({
        code: "custom",
        message: "Invalid attempt revisions or operation identity",
      });
    for (const operation of attempt.operations) {
      if (
        operation.kind === "register" &&
        operation.slots.some(
          (entry) =>
            entry.kind === "created" &&
            !attempt.operations.some(
              (op) =>
                op.kind === "post" && op.operationId === entry.operationId,
            ),
        )
      )
        context.addIssue({
          code: "custom",
          message: "Registered slots require their recorded POST",
        });
    }
  });
export type PreparedMeetingUpdateAttempt = z.infer<
  typeof preparedMeetingUpdateAttemptSchema
>;

const submittedFields = z.object({ submissionId: id, submittedAt: seconds });
const receipt = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("message"), messageId: id }).strict(),
]);
export const meetingUpdateSubmissionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prepared") }).strict(),
  submittedFields.extend({ kind: z.literal("submitted") }).strict(),
  submittedFields
    .extend({
      kind: z.literal("returned"),
      messageId: id,
      returnedAt: seconds,
    })
    .strict(),
  submittedFields
    .extend({
      kind: z.literal("verified"),
      verifiedAt: seconds,
      fingerprint,
      receipt: receipt.default({ kind: "none" }),
    })
    .strict(),
  submittedFields
    .extend({
      kind: z.literal("rejected"),
      rejectedAt: seconds,
      retryAt: seconds,
      reason: z.enum(["rate_limited", "provider_rejected"]),
    })
    .strict(),
  submittedFields
    .extend({
      kind: z.literal("uncertain"),
      reason: z.enum(["provider_outcome_unknown", "completion_unknown"]),
    })
    .strict(),
]);
export type MeetingUpdateSubmission = z.infer<
  typeof meetingUpdateSubmissionSchema
>;
const operationProgress = z
  .object({
    operationId: id,
    submission: meetingUpdateSubmissionSchema,
  })
  .strict();
const attemptProgress = z.object({
  attempt: preparedMeetingUpdateAttemptSchema,
  claim: z.object({ ownerInstanceId: id, leaseExpiresAt: seconds }).strict(),
  nextCheckAt: seconds,
  operations: z.array(operationProgress).min(1).max(300),
});
const pendingProgress = z
  .object({ kind: z.literal("pending"), nextCheckAt: seconds })
  .strict();
const reason = z.enum([
  "missing_target",
  "inaccessible_destination",
  "unsupported_layout",
  "initial_publication_unsettled",
  "legacy_publication_unknown",
  "provider_outcome_unknown",
  "retry_exhausted",
]);
export const meetingUpdateProgressSchema = z.discriminatedUnion("kind", [
  pendingProgress,
  z
    .object({
      kind: z.literal("retrying"),
      nextCheckAt: seconds,
      attempts: revisionNumber.positive(),
      reason: z.enum(["rate_limited", "provider_rejected", "not_submitted"]),
    })
    .strict(),
  attemptProgress.extend({ kind: z.literal("running") }).strict(),
  attemptProgress.extend({ kind: z.literal("reconciling") }).strict(),
  attemptProgress
    .omit({ nextCheckAt: true })
    .extend({
      kind: z.literal("uncertain"),
      reason: z.literal("provider_outcome_unknown"),
    })
    .strict(),
  z.object({ kind: z.literal("synced"), syncedAt: seconds }).strict(),
  z.object({ kind: z.literal("blocked"), reason }).strict(),
]);
export type MeetingUpdateProgress = z.infer<typeof meetingUpdateProgressSchema>;
type AttemptProgress = Extract<
  MeetingUpdateProgress,
  { kind: "running" | "reconciling" | "uncertain" }
>;
export const meetingUpdatePolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active") }).strict(),
  z.object({ kind: z.literal("unpublished") }).strict(),
  z
    .object({
      kind: z.literal("held"),
      reason: z.enum([
        "stored_only",
        "explicit_hold",
        "initial_publication_unsettled",
        "legacy_publication_unknown",
      ]),
    })
    .strict(),
]);
export const meetingUpdateCreatedCandidateSchema = z
  .object({
    operationId: id,
    channelId: id,
    messageId: id,
    fingerprint,
  })
  .strict();
export type MeetingUpdateCreatedCandidate = z.infer<
  typeof meetingUpdateCreatedCandidateSchema
>;
export const meetingUpdateDeliverySchema = z
  .object({
    revision: id,
    policy: meetingUpdatePolicySchema,
    createdCandidates: z
      .array(meetingUpdateCreatedCandidateSchema)
      .max(300)
      .default([]),
    parts: partWatermarksSchema,
    progress: meetingUpdateProgressSchema,
  })
  .strict()
  .superRefine((delivery, context) => {
    if (
      delivery.progress.kind === "synced" &&
      presentationPartSchema.options.some(
        (part) =>
          delivery.parts[part].desired !== delivery.parts[part].acknowledged,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Synced delivery has pending parts",
      });
    if (hasAttempt(delivery.progress))
      validateAttemptProgress(delivery.progress, delivery.parts, context);
  });
export type MeetingUpdateDelivery = z.infer<typeof meetingUpdateDeliverySchema>;

function hasAttempt(
  progress: MeetingUpdateProgress,
): progress is AttemptProgress {
  return (
    progress.kind === "running" ||
    progress.kind === "reconciling" ||
    progress.kind === "uncertain"
  );
}
function validateAttemptProgress(
  progress: AttemptProgress,
  parts: PartWatermarks,
  context: z.RefinementCtx,
): void {
  const plan = progress.attempt;
  if (
    progress.operations.length !== plan.operations.length ||
    progress.operations.some(
      (op, index) => op.operationId !== plan.operations[index].operationId,
    ) ||
    Object.entries(plan.capturedParts).some(
      ([part, captured]) =>
        captured > parts[presentationPartSchema.parse(part)].desired,
    )
  )
    context.addIssue({
      code: "custom",
      message: "Progress must match the captured plan",
    });
  for (const [index, operation] of plan.operations.entries())
    validateOperationReceipt(
      operation,
      progress.operations[index]?.submission,
      context,
    );
}
function validateOperationReceipt(
  operation: MeetingUpdateProviderOperation,
  submission: MeetingUpdateSubmission | undefined,
  context: z.RefinementCtx,
): void {
  if (!submission) return;
  if (submission.kind === "returned" && operation.kind !== "post")
    context.addIssue({
      code: "custom",
      message: "Only POST returns a new message identity",
    });
  if (submission.kind !== "verified") return;
  const expected =
    operation.kind === "patch" || operation.kind === "post"
      ? operation.desiredFingerprint
      : operation.kind === "delete"
        ? operation.beforeFingerprint
        : undefined;
  if (
    (expected !== undefined && submission.fingerprint !== expected) ||
    (operation.kind === "post" && submission.receipt.kind !== "message") ||
    (operation.kind !== "post" && submission.receipt.kind !== "none")
  )
    context.addIssue({
      code: "custom",
      message: "Verification must match the recorded operation",
    });
}

const revisionsSchema = z
  .object({
    contentRevision: revisionNumber.default(0),
    notesVersion: revisionNumber.positive().default(1),
  })
  .strict();
export function readMeetingUpdateRevisions(
  history: Pick<MeetingHistory, "contentRevision" | "notesVersion">,
) {
  return revisionsSchema.parse({
    contentRevision: history.contentRevision,
    notesVersion: history.notesVersion,
  });
}
export function requestMeetingUpdateDelivery(input: {
  history: Pick<
    MeetingHistory,
    "contentRevision" | "notesVersion" | "updateDelivery"
  >;
  mutation: MeetingUpdateMutation;
  revision: string;
  now: number;
  policy: z.infer<typeof meetingUpdatePolicySchema>;
}): MeetingUpdateDelivery {
  const previous = input.history.updateDelivery
    ? meetingUpdateDeliverySchema.parse(input.history.updateDelivery)
    : undefined;
  const contentRevision = revisionNumber.parse(
    readMeetingUpdateRevisions(input.history).contentRevision + 1,
  );
  const parts: PartWatermarks = previous
    ? structuredClone(previous.parts)
    : partWatermarksSchema.parse(
        Object.fromEntries(
          presentationPartSchema.options.map((part) => [
            part,
            { desired: 0, acknowledged: 0 },
          ]),
        ),
      );
  for (const part of requestedPartsForMutation(input.mutation))
    parts[part].desired = contentRevision;
  const next = meetingUpdateDeliverySchema.parse({
    revision: input.revision,
    policy: previous?.policy ?? input.policy,
    parts,
    createdCandidates: previous?.createdCandidates,
    progress:
      previous && previous.progress.kind !== "synced"
        ? previous.progress
        : { kind: "pending", nextCheckAt: input.now },
  });
  if (previous) assertMeetingUpdateDeliveryTransition(previous, next);
  return next;
}

export function meetingUpdateDeliveryNextCheck(
  delivery: MeetingUpdateDelivery,
): number | undefined {
  const parsed = meetingUpdateDeliverySchema.parse(delivery);
  return parsed.policy.kind === "active" && "nextCheckAt" in parsed.progress
    ? parsed.progress.nextCheckAt
    : undefined;
}

export function assertMeetingUpdateDeliveryTransition(
  before: MeetingUpdateDelivery,
  after: MeetingUpdateDelivery,
): void {
  before = meetingUpdateDeliverySchema.parse(before);
  after = meetingUpdateDeliverySchema.parse(after);
  if (before.revision === after.revision)
    throw new Error("Delivery transitions require a fresh revision");
  assertWatermarks(before, after);
  assertCreatedCandidates(before, after);
  if (hasAttempt(before.progress))
    assertAttemptTransition(before.progress, after.progress);
}
function assertWatermarks(
  before: MeetingUpdateDelivery,
  after: MeetingUpdateDelivery,
): void {
  const completing = hasAttempt(before.progress) && !hasAttempt(after.progress);
  for (const part of presentationPartSchema.options) {
    const previous = before.parts[part];
    const next = after.parts[part];
    if (
      next.desired < previous.desired ||
      next.acknowledged < previous.acknowledged
    )
      throw new Error("Part revisions cannot regress");
    if (next.acknowledged === previous.acknowledged) continue;
    if (
      !completing ||
      !hasAttempt(before.progress) ||
      !before.progress.operations.every(
        (op) => op.submission.kind === "verified",
      ) ||
      next.acknowledged !==
        Math.max(
          previous.acknowledged,
          before.progress.attempt.capturedParts[part] ?? 0,
        )
    )
      throw new Error("Only verified captured parts may be acknowledged");
  }
}
function knownCreatedCandidates(
  progress: MeetingUpdateProgress,
): MeetingUpdateCreatedCandidate[] {
  if (!hasAttempt(progress)) return [];
  return progress.operations.flatMap((operation, index) => {
    const plan = progress.attempt.operations[index];
    const result = operation.submission;
    if (plan.kind !== "post") return [];
    const messageId =
      result.kind === "returned"
        ? result.messageId
        : result.kind === "verified" && result.receipt.kind === "message"
          ? result.receipt.messageId
          : undefined;
    return messageId
      ? [
          {
            operationId: operation.operationId,
            channelId: plan.channelId,
            messageId,
            fingerprint: plan.desiredFingerprint,
          },
        ]
      : [];
  });
}
function candidateRegisteredOrDeleted(
  candidate: MeetingUpdateCreatedCandidate,
  progress: MeetingUpdateProgress,
): boolean {
  if (!hasAttempt(progress)) return false;
  return progress.attempt.operations.some((plan, index) => {
    if (progress.operations[index].submission.kind !== "verified") return false;
    if (plan.kind === "delete")
      return (
        plan.messageId === candidate.messageId &&
        plan.channelId === candidate.channelId
      );
    if (plan.kind !== "register" || plan.notesChannelId !== candidate.channelId)
      return false;
    return plan.slots.some((slot) =>
      slot.kind === "existing"
        ? slot.messageId === candidate.messageId
        : slot.operationId === candidate.operationId,
    );
  });
}
function assertCreatedCandidates(
  before: MeetingUpdateDelivery,
  after: MeetingUpdateDelivery,
): void {
  const candidates = [
    ...before.createdCandidates,
    ...knownCreatedCandidates(before.progress),
  ];
  const retained = [
    ...after.createdCandidates,
    ...knownCreatedCandidates(after.progress),
  ];
  for (const candidate of candidates)
    if (
      !retained.some((next) => isDeepStrictEqual(candidate, next)) &&
      !candidateRegisteredOrDeleted(candidate, before.progress)
    )
      throw new Error(
        "Created message identity must survive until registration or cleanup",
      );
}
function isSettled(submission: MeetingUpdateSubmission): boolean {
  return submission.kind === "verified" || submission.kind === "rejected";
}
function assertAttemptTransition(
  before: AttemptProgress,
  after: MeetingUpdateProgress,
): void {
  if (!hasAttempt(after)) {
    if (
      before.operations.some(
        (op) => op.submission.kind !== "prepared" && !isSettled(op.submission),
      )
    )
      throw new Error("Unsettled attempt cannot be discarded");
    return;
  }
  if (!isDeepStrictEqual(before.attempt, after.attempt))
    throw new Error("Prepared attempt is immutable");
  if (
    after.kind === "running" &&
    (before.claim.ownerInstanceId !== after.claim.ownerInstanceId ||
      (before.kind !== "running" &&
        before.operations.some((op) => !isSettled(op.submission))))
  )
    throw new Error("Reconciliation does not authorize provider replay");
  for (const [index, previous] of before.operations.entries()) {
    const next = after.operations[index];
    assertSubmissionTransition(previous.submission, next.submission);
    if (
      previous.submission.kind === "prepared" &&
      next.submission.kind !== "prepared" &&
      (after.kind !== "running" ||
        next.submission.kind !== "submitted" ||
        next.submission.submittedAt >= after.claim.leaseExpiresAt)
    )
      throw new Error("Submission requires an active running claim");
  }
}
function assertSubmissionTransition(
  before: MeetingUpdateSubmission,
  after: MeetingUpdateSubmission,
): void {
  if (isDeepStrictEqual(before, after)) return;
  if (before.kind === "prepared") return;
  if (
    after.kind === "prepared" ||
    before.submissionId !== after.submissionId ||
    before.submittedAt !== after.submittedAt ||
    isSettled(before)
  )
    throw new Error("Recorded submission cannot be replaced or replayed");
  if (
    before.kind === "returned" &&
    (after.kind !== "verified" ||
      after.receipt.kind !== "message" ||
      after.receipt.messageId !== before.messageId)
  )
    throw new Error("Returned POST identity must survive verification");
  if (after.kind === "submitted")
    throw new Error(
      "Submitted effects can only advance to known results or reconciliation",
    );
}

export const meetingUpdateDeliveryTransitionSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("progress"),
        revision: id,
        progress: meetingUpdateProgressSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("complete"),
        revision: id,
        attemptId: id,
        completedAt: seconds,
      })
      .strict(),
    z
      .object({
        kind: z.literal("policy"),
        revision: id,
        policy: meetingUpdatePolicySchema,
        nextCheckAt: seconds,
      })
      .strict(),
  ],
);
export type MeetingUpdateDeliveryTransition = z.infer<
  typeof meetingUpdateDeliveryTransitionSchema
>;
export const meetingUpdateDeliveryCursorSchema = z
  .object({
    guildId: id,
    channelId_timestamp: id,
    updateDeliveryQueue: z.literal(MEETING_UPDATE_DELIVERY_QUEUE),
    updateDeliveryDueAt: seconds,
  })
  .strict();
export type MeetingUpdateDeliveryCursor = z.infer<
  typeof meetingUpdateDeliveryCursorSchema
>;
export function readMeetingUpdateDeliveryCursor(
  cursor?: string,
): MeetingUpdateDeliveryCursor | undefined {
  if (cursor === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 8192)
    throw new Error("Invalid meeting update cursor");
  return meetingUpdateDeliveryCursorSchema.parse(
    JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
  );
}
export function writeMeetingUpdateDeliveryCursor(
  cursor: MeetingUpdateDeliveryCursor,
): string {
  return Buffer.from(
    JSON.stringify(meetingUpdateDeliveryCursorSchema.parse(cursor)),
  ).toString("base64url");
}
