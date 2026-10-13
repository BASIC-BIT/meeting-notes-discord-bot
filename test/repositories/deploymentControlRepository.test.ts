/** @jest-environment node */
import {
  createMockDeploymentControlRepository,
  classifyDeploymentTransactionError,
} from "../../src/repositories/deploymentControlRepository";
import { parseDeploymentControlRecord } from "../../src/types/deploymentControl";
import {
  context,
  control,
  runtime,
  promotion,
  history,
} from "../deployment/controlFixtures";

test("missingControlRejectsAdmission", async () => {
  const repository = createMockDeploymentControlRepository();
  await repository.writeRuntime(runtime("old"));
  expect(await repository.checkAdmission(context)).toEqual({
    kind: "blocked",
    reason: "not_serving",
  });
});

test("promotionAndOldAdmissionHaveOnlyTwoLegalOrders", async () => {
  const repository = createMockDeploymentControlRepository();
  await repository.initializeControl(control);
  await repository.writeRuntime(runtime("old"));
  await repository.writeRuntime(runtime("new", "candidate"));
  expect((await repository.checkAdmission(context)).kind).toBe("admitted");
  expect(await repository.promote(promotion)).toBe("applied");
  expect((await repository.checkAdmission(context)).kind).toBe("blocked");
  expect(
    (
      await repository.checkAdmission({
        ...context,
        instanceId: "new",
        authorizedGeneration: 8,
      })
    ).kind,
  ).toBe("admitted");
});

test("staleEpochCannotPromote", async () => {
  const repository = createMockDeploymentControlRepository();
  await repository.initializeControl(control);
  await repository.writeRuntime(runtime("new", "candidate"));
  expect(await repository.promote({ ...promotion, coordinatorEpoch: 2 })).toBe(
    "stale",
  );
});

test("lateInitialHistoryCannotOverwriteProgress", async () => {
  const repository = createMockDeploymentControlRepository();
  expect(await repository.createInitialMeetingHistory(history)).toBe("applied");
  const transition = {
    key: {
      guildId: history.guildId,
      channelId_timestamp: history.channelId_timestamp,
    },
    expectedMeetingId: "meeting",
    expectedOwnerInstanceId: "old",
    expectedExecutionVersion: 1,
    expectedStatus: "starting" as const,
    patch: { status: "processing" as const },
  };
  expect(await repository.transitionMeetingHistory(transition)).toBe("applied");
  expect(await repository.createInitialMeetingHistory(history)).toBe("stale");
  expect(await repository.transitionMeetingHistory(transition)).toBe("stale");
  expect((await repository.getMeetingHistory(transition.key))?.status).toBe(
    "processing",
  );
});

test("ordinary history progress preserves the execution attempt fence", async () => {
  const repository = createMockDeploymentControlRepository();
  await repository.createInitialMeetingHistory(history);
  const key = {
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  };
  for (const [expectedStatus, status] of [
    ["starting", "in_progress"],
    ["in_progress", "processing"],
  ] as const) {
    const transition = {
      key,
      expectedMeetingId: "meeting",
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus,
      patch: { status },
    };
    expect(
      await repository.transitionMeetingHistory({
        ...transition,
        expectedExecutionVersion: 2,
      }),
    ).toBe("stale");
    expect(
      await repository.transitionMeetingHistory({
        ...transition,
        expectedOwnerInstanceId: "former-owner",
      }),
    ).toBe("stale");
    expect(await repository.transitionMeetingHistory(transition)).toBe(
      "applied",
    );
    expect(await repository.getMeetingHistory(key)).toMatchObject({
      status,
      executionVersion: 1,
      ownerInstanceId: "old",
    });
    expect(await repository.transitionMeetingHistory(transition)).toBe("stale");
  }
});

test("ttlNeverDeletesUnsettledVoice", () => {
  const voice = {
    pk: "VOICE#guild",
    sk: "STATE",
    recordType: "voice",
    protocolVersion: 1,
    guildId: "guild",
    ownerInstanceId: "old",
    meetingId: "meeting",
    attemptId: "attempt",
    state: "uncertain",
    updatedAt: 100,
  };
  expect(parseDeploymentControlRecord(voice)).not.toHaveProperty("expiresAt");
  expect(() =>
    parseDeploymentControlRecord({ ...voice, expiresAt: 200 }),
  ).toThrow();
  expect(() =>
    parseDeploymentControlRecord({ ...control, expiresAt: 200 }),
  ).toThrow();
  expect(() =>
    parseDeploymentControlRecord({ ...runtime("old"), expiresAt: 200 }),
  ).toThrow();
});

test.each(["gatewayReady", "cacheReady", "dependenciesReady"] as const)(
  "admission rejects false %s proof",
  async (field) => {
    const repository = createMockDeploymentControlRepository();
    await repository.initializeControl(control);
    const row = runtime("old");
    row.readiness[field] = false;
    await repository.writeRuntime(row);
    expect((await repository.checkAdmission(context)).kind).toBe("blocked");
  },
);

test("errors distinguish conflicts, stale conditions and outages", () => {
  expect(
    classifyDeploymentTransactionError({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "TransactionConflict" }],
    }),
  ).toBe("conflict");
  expect(
    classifyDeploymentTransactionError({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    }),
  ).toBe("stale");
  expect(
    classifyDeploymentTransactionError(new Error("connection refused")),
  ).toBe("unavailable");
  expect(
    classifyDeploymentTransactionError({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ValidationError" }],
    }),
  ).toBe("unavailable");
});

test("proofs cannot bind a local confirmation to an ECS runtime", () => {
  const row = runtime("old");
  expect(() =>
    parseDeploymentControlRecord({
      ...row,
      protection: {
        ...row.protection,
        identity: {
          kind: "local",
          localId: "fixture",
          instanceId: "old",
          protocolVersion: 1,
        },
      },
    }),
  ).toThrow();
});

test("voice CAS rejects stale settlement and replacing an unsettled attempt", async () => {
  const repository = createMockDeploymentControlRepository();
  const voice = {
    pk: "VOICE#guild",
    sk: "STATE" as const,
    recordType: "voice" as const,
    protocolVersion: 1 as const,
    guildId: "guild",
    meetingId: "meeting",
    ownerInstanceId: "old",
    attemptId: "first",
    state: "uncertain" as const,
    updatedAt: 100,
  };
  expect(await repository.writeVoice(voice)).toBe("applied");
  expect(
    await repository.writeVoice({ ...voice, attemptId: "second" }, voice),
  ).toBe("stale");
  expect(
    await repository.writeVoice(
      { ...voice, state: "settled" },
      { ...voice, ownerInstanceId: "other" },
    ),
  ).toBe("stale");
  expect(
    await repository.writeVoice(
      { ...voice, state: "settled" },
      { ...voice, meetingId: "other" },
    ),
  ).toBe("stale");
  expect(
    await repository.writeVoice({ ...voice, state: "settled" }, voice),
  ).toBe("applied");
  expect(
    await repository.writeVoice({ ...voice, state: "connected" }, voice),
  ).toBe("stale");
  expect(
    await repository.writeVoice(
      { ...voice, attemptId: "second", state: "joining" },
      { ...voice, state: "settled" },
    ),
  ).toBe("applied");
});

test("stale runtime heartbeats cannot restore the prior generation", async () => {
  const repository = createMockDeploymentControlRepository();
  await repository.initializeControl(control);
  await repository.writeRuntime(runtime("new", "candidate"));
  await repository.promote(promotion);
  expect(await repository.writeRuntime(runtime("new", "candidate"))).toBe(
    "stale",
  );
});

test("history patch cannot replace unrelated data or rewind status", async () => {
  const repository = createMockDeploymentControlRepository();
  await repository.createInitialMeetingHistory(history);
  const transition = {
    key: {
      guildId: history.guildId,
      channelId_timestamp: history.channelId_timestamp,
    },
    expectedMeetingId: "meeting",
    expectedOwnerInstanceId: "old",
    expectedExecutionVersion: 1,
    expectedStatus: "complete" as const,
    patch: { status: "starting" as const },
  };
  await expect(repository.transitionMeetingHistory(transition)).rejects.toThrow(
    "Illegal history status transition",
  );
  await expect(
    repository.transitionMeetingHistory({
      ...transition,
      patch: { ...{ notes: "unrelated" } },
    }),
  ).rejects.toThrow("not allowed");
});
