/** @jest-environment node */
import type { MeetingHistory } from "../../src/types/db";
import {
  assertMeetingUpdateDeliveryTransition,
  meetingUpdateDeliveryNextCheck,
  meetingUpdateDeliverySchema,
  meetingUpdateMutationSchema,
  preparedMeetingUpdateAttemptSchema,
  readMeetingUpdateDeliveryCursor,
  readMeetingUpdateRevisions,
  requestedPartsForMutation,
  requestMeetingUpdateDelivery,
  writeMeetingUpdateDeliveryCursor,
} from "../../src/types/meetingUpdateDelivery";

const now = 1792670400;
const key = {
  guildId: "999999999999999990",
  channelId_timestamp: "999999999999999991#2026-10-22T12:00:00.000Z",
};
const pointers = {
  notesChannelId: "999999999999999992",
  notesMessageIds: ["999999999999999993"],
};
const history = (): MeetingHistory => ({
  ...key,
  meetingId: "synthetic-meeting",
  channelId: "999999999999999991",
  timestamp: "2026-10-22T12:00:00.000Z",
  notes: "Original synthetic notes",
  participants: [],
  duration: 60,
  transcribeMeeting: true,
  generateNotes: true,
});
const notes = meetingUpdateMutationSchema.parse({
  kind: "notes",
  notes: "Edited synthetic notes",
});
const rename = meetingUpdateMutationSchema.parse({
  kind: "rename",
  meetingName: "Synthetic planning",
});
function parts() {
  return {
    notesBody: { desired: 0, acknowledged: 0 },
    notesTitle: { desired: 0, acknowledged: 0 },
    notesWarning: { desired: 0, acknowledged: 0 },
    summaryBody: { desired: 0, acknowledged: 0 },
    summaryTitle: { desired: 0, acknowledged: 0 },
    summaryWarning: { desired: 0, acknowledged: 0 },
  };
}
function pending() {
  return meetingUpdateDeliverySchema.parse({
    revision: "delivery-1",
    policy: { kind: "active" },
    parts: {
      ...parts(),
      notesBody: { desired: 1, acknowledged: 0 },
    },
    progress: { kind: "pending", nextCheckAt: now },
  });
}
function attempt() {
  return preparedMeetingUpdateAttemptSchema.parse({
    attemptId: "attempt-1",
    contentRevision: 1,
    capturedParts: { notesBody: 1 },
    expectedPointers: pointers,
    operations: [
      {
        kind: "patch",
        operationId: "patch-notes",
        channelId: pointers.notesChannelId,
        messageId: pointers.notesMessageIds[0],
        beforeFingerprint: "a".repeat(64),
        desiredFingerprint: "b".repeat(64),
      },
    ],
  });
}
function running(submission: "submitted" | "verified" = "submitted") {
  return meetingUpdateDeliverySchema.parse({
    ...pending(),
    progress: {
      kind: "running",
      attempt: attempt(),
      claim: {
        ownerInstanceId: "synthetic-owner",
        leaseExpiresAt: now - 1,
      },
      nextCheckAt: now,
      operations: [
        {
          operationId: "patch-notes",
          submission:
            submission === "submitted"
              ? {
                  kind: "submitted",
                  submissionId: "submission-1",
                  submittedAt: now - 30,
                }
              : {
                  kind: "verified",
                  submissionId: "submission-1",
                  submittedAt: now - 30,
                  verifiedAt: now - 2,
                  fingerprint: "b".repeat(64),
                },
        },
      ],
    },
  });
}

test("notes edit preserves pending rename watermarks", () => {
  const before = requestMeetingUpdateDelivery({
    history: history(),
    mutation: rename,
    revision: "rename-request",
    now,
    policy: { kind: "active" },
  });
  const after = requestMeetingUpdateDelivery({
    history: {
      ...history(),
      contentRevision: 1,
      updateDelivery: before,
    },
    mutation: notes,
    revision: "notes-request",
    now: now + 1,
    policy: { kind: "active" },
  });
  expect(before.parts.notesTitle).toEqual({ desired: 1, acknowledged: 0 });
  expect(before.parts.summaryTitle).toEqual({ desired: 1, acknowledged: 0 });
  expect(after.parts.notesBody).toEqual({ desired: 2, acknowledged: 0 });
  expect(after.parts.notesTitle).toEqual(before.parts.notesTitle);
  expect(after.parts.summaryTitle).toEqual(before.parts.summaryTitle);
  expect(after.progress).toEqual(before.progress);
  expect(() => assertMeetingUpdateDeliveryTransition(before, after)).not.toThrow();
});

test("request retains submitted attempt", () => {
  const before = running();
  const after = requestMeetingUpdateDelivery({
    history: {
      ...history(),
      contentRevision: 1,
      updateDelivery: before,
    },
    mutation: notes,
    revision: "delivery-2",
    now,
    policy: { kind: "active" },
  });
  expect(after.parts.notesBody).toEqual({ desired: 2, acknowledged: 0 });
  expect(after.progress).toEqual(before.progress);
  expect(after.revision).toBe("delivery-2");
  expect(before.parts.notesBody.desired).toBe(1);
  expect(() => assertMeetingUpdateDeliveryTransition(before, after)).not.toThrow();
});

test("completion acknowledges only captured parts", () => {
  const before = meetingUpdateDeliverySchema.parse({
    ...running("verified"),
    parts: {
      ...parts(),
      notesBody: { desired: 2, acknowledged: 0 },
      summaryTitle: { desired: 2, acknowledged: 0 },
    },
  });
  const after = meetingUpdateDeliverySchema.parse({
    ...before,
    revision: "completion-2",
    parts: {
      ...before.parts,
      notesBody: { desired: 2, acknowledged: 1 },
    },
    progress: { kind: "pending", nextCheckAt: now },
  });
  expect(() => assertMeetingUpdateDeliveryTransition(before, after)).not.toThrow();
  expect(after.parts.notesBody).toEqual({ desired: 2, acknowledged: 1 });
  expect(after.parts.summaryTitle).toEqual(before.parts.summaryTitle);
  expect(meetingUpdateDeliveryNextCheck(after)).toBe(now);
  for (const part of ["notesBody", "summaryTitle"]) {
    const overAcknowledged = meetingUpdateDeliverySchema.parse({
      ...after,
      parts: {
        ...after.parts,
        [part]: { desired: 2, acknowledged: 2 },
      },
    });
    expect(() =>
      assertMeetingUpdateDeliveryTransition(before, overAcknowledged),
    ).toThrow();
  }
});

test("held state retains unsettled attempt", () => {
  const before = meetingUpdateDeliverySchema.parse({
    ...running(),
    policy: { kind: "held", reason: "stored_only" },
  });
  const after = requestMeetingUpdateDelivery({
    history: {
      ...history(),
      contentRevision: 1,
      updateDelivery: before,
    },
    mutation: notes,
    revision: "held-request-2",
    now,
    policy: { kind: "active" },
  });
  expect(after.policy).toEqual(before.policy);
  expect(after.progress).toEqual(before.progress);
  expect(after.parts.notesBody.desired).toBe(2);
  expect(meetingUpdateDeliveryNextCheck(after)).toBeUndefined();
  expect(() => assertMeetingUpdateDeliveryTransition(before, after)).not.toThrow();
  const discarded = meetingUpdateDeliverySchema.parse({
    ...after,
    revision: "discarded-attempt",
    progress: { kind: "pending", nextCheckAt: now },
  });
  expect(() =>
    assertMeetingUpdateDeliveryTransition(after, discarded),
  ).toThrow();
});

test("expired lease cannot authorize replay", () => {
  const before = running();
  expect(meetingUpdateDeliveryNextCheck(before)).toBe(now);
  if (before.progress.kind !== "running")
    throw new Error("Expected running fixture");
  const replay = meetingUpdateDeliverySchema.parse({
    ...before,
    revision: "replayed-2",
    progress: {
      ...before.progress,
      claim: {
        ownerInstanceId: "replacement-owner",
        leaseExpiresAt: now + 30,
      },
      operations: [
        { operationId: "patch-notes", submission: { kind: "prepared" } },
      ],
    },
  });
  expect(() => assertMeetingUpdateDeliveryTransition(before, replay)).toThrow();
  const replaced = meetingUpdateDeliverySchema.parse({
    ...replay,
    progress: {
      ...replay.progress,
      attempt: { ...attempt(), attemptId: "replacement-attempt" },
    },
  });
  expect(() => assertMeetingUpdateDeliveryTransition(before, replaced)).toThrow();
  const reconcile = meetingUpdateDeliverySchema.parse({
    ...before,
    revision: "reconcile-2",
    progress: { ...before.progress, kind: "reconciling" },
  });
  expect(reconcile.progress).toMatchObject({ attempt: before.progress.attempt });
  expect(() =>
    assertMeetingUpdateDeliveryTransition(before, reconcile),
  ).not.toThrow();
});

test("legacy revisions remain zero and one", () => {
  const legacy = history();
  expect(readMeetingUpdateRevisions(legacy)).toEqual({
    contentRevision: 0,
    notesVersion: 1,
  });
  expect(
    readMeetingUpdateRevisions({
      ...legacy,
      contentRevision: 7,
      notesVersion: 4,
    }),
  ).toEqual({ contentRevision: 7, notesVersion: 4 });
  const requested = requestMeetingUpdateDelivery({
    history: legacy,
    mutation: notes,
    revision: "legacy-request",
    now,
    policy: { kind: "active" },
  });
  expect(requested.parts.notesBody).toEqual({ desired: 1, acknowledged: 0 });
  expect(legacy).not.toHaveProperty("contentRevision");
  expect(legacy).not.toHaveProperty("notesVersion");
});

test("notes requests do not include an unrelated summary", () => {
  expect(requestedPartsForMutation(notes)).toEqual(["notesBody"]);
  expect(requestedPartsForMutation(rename)).toEqual([
    "notesTitle",
    "summaryTitle",
  ]);
});

test("every transition needs an independent delivery revision", () => {
  const before = pending();
  const unchangedToken = meetingUpdateDeliverySchema.parse({
    ...before,
    parts: {
      ...before.parts,
      notesBody: { desired: 2, acknowledged: 0 },
    },
  });
  expect(() =>
    assertMeetingUpdateDeliveryTransition(before, unchangedToken),
  ).toThrow();
  const renewed = meetingUpdateDeliverySchema.parse({
    ...before,
    revision: "new-opaque-token",
    progress: { kind: "pending", nextCheckAt: now + 5 },
  });
  expect(() =>
    assertMeetingUpdateDeliveryTransition(before, renewed),
  ).not.toThrow();
});

test("submitted effects cannot be acknowledged before verification", () => {
  const before = running();
  const completed = meetingUpdateDeliverySchema.parse({
    ...before,
    revision: "premature-completion",
    parts: {
      ...before.parts,
      notesBody: { desired: 1, acknowledged: 1 },
    },
    progress: { kind: "synced", syncedAt: now },
  });
  expect(() =>
    assertMeetingUpdateDeliveryTransition(before, completed),
  ).toThrow();
});

test("rejects contradictory delivery state and duplicated payload bodies", () => {
  const invalid = [
    { ...pending(), attempt: attempt() },
    { ...pending(), notes: "Duplicated payload" },
    { ...pending(), progress: { kind: "synced", syncedAt: now } },
    {
      ...pending(),
      parts: {
        ...parts(),
        notesBody: { desired: 1, acknowledged: 2 },
      },
    },
    {
      ...pending(),
      progress: { kind: "pending", nextCheckAt: now, attempt: attempt() },
    },
  ];
  for (const value of invalid)
    expect(meetingUpdateDeliverySchema.safeParse(value).success).toBe(false);
  expect(
    preparedMeetingUpdateAttemptSchema.safeParse({
      ...attempt(),
      operations: [
        {
          ...attempt().operations[0],
          payload: { embeds: [{ description: "Duplicated provider body" }] },
        },
      ],
    }).success,
  ).toBe(false);
});

test.each(["unpublished", "held"] as const)(
  "%s policy has no due work",
  (kind) => {
    const delivery = meetingUpdateDeliverySchema.parse({
      ...pending(),
      policy: kind === "held" ? { kind, reason: "stored_only" } : { kind },
    });
    expect(meetingUpdateDeliveryNextCheck(delivery)).toBeUndefined();
  },
);

test("synced and blocked progress have no due work", () => {
  for (const progress of [
    { kind: "synced", syncedAt: now },
    { kind: "blocked", reason: "missing_target" },
  ]) {
    const delivery = meetingUpdateDeliverySchema.parse({
      ...pending(),
      parts: parts(),
      progress,
    });
    expect(meetingUpdateDeliveryNextCheck(delivery)).toBeUndefined();
  }
});

test("due cursor round trips exact keys and epoch seconds", () => {
  const cursor = {
    ...key,
    updateDeliveryQueue: "meeting-update:v1",
    updateDeliveryDueAt: now,
  };
  expect(readMeetingUpdateDeliveryCursor()).toBeUndefined();
  expect(
    readMeetingUpdateDeliveryCursor(writeMeetingUpdateDeliveryCursor(cursor)),
  ).toEqual(cursor);
});

test("due cursor rejects malformed or widened discovery keys", () => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const value of [
    null,
    {},
    {
      ...key,
      updateDeliveryQueue: "wrong-queue",
      updateDeliveryDueAt: now,
    },
    {
      ...key,
      updateDeliveryQueue: "meeting-update:v1",
      updateDeliveryDueAt: -1,
    },
    {
      ...key,
      updateDeliveryQueue: "meeting-update:v1",
      updateDeliveryDueAt: now + 0.5,
    },
    {
      ...key,
      updateDeliveryQueue: "meeting-update:v1",
      updateDeliveryDueAt: now,
      extra: "unexpected",
    },
  ]) {
    expect(() => readMeetingUpdateDeliveryCursor(encode(value))).toThrow();
  }
  expect(() => readMeetingUpdateDeliveryCursor("not-json")).toThrow();
});
