/** @jest-environment node */
import { createMockDeploymentControlRepository } from "../../src/repositories/deploymentControlRepository";
import {
  control,
  context,
  history,
  runtime,
} from "../deployment/controlFixtures";
import type { ActiveMeetingLease, MeetingHistory } from "../../src/types/db";

async function fixture() {
  const row: MeetingHistory = {
    ...history,
    status: "interrupted",
    recovery: {
      disposition: "pending",
      attempt: 0,
      executionVersion: 1,
      stage: "verification",
      retry: { maxAttempts: 4, nextAttemptAt: null },
    },
  };
  const histories = new Map([[row.guildId, [row]]]);
  const leases = new Map<string, ActiveMeetingLease>();
  const repository = createMockDeploymentControlRepository(
    undefined,
    histories,
    leases,
  );
  await repository.initializeControl(control);
  await repository.writeRuntime(runtime("old"));
  return { repository, row, leases };
}
test("twoRecoverersProduceOneAttempt and oldFinalizerCannotOverwriteRecovery", async () => {
  const f = await fixture();
  const results = await Promise.all(
    ["one", "two"].map((attemptId) =>
      f.repository.claimRecordingRecovery({
        history: f.row,
        lease: undefined,
        context,
        attemptId,
      }),
    ),
  );
  expect(results.filter((row) => row !== undefined)).toHaveLength(1);
  expect(f.leases.get("guild")).toMatchObject({
    sessionMode: "recovery",
    executionVersion: 2,
  });
  expect(f.leases.get("guild")).not.toHaveProperty("voiceOperationAttemptId");
  expect(
    await f.repository.transitionMeetingHistory({
      key: history,
      expectedMeetingId: history.meetingId,
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus: "interrupted",
      patch: { status: "processing" },
    }),
  ).toBe("stale");
});
test("liveRenewedOwnerBeatsRecoveryClaim", async () => {
  const f = await fixture();
  const lease: ActiveMeetingLease = {
    guildId: "guild",
    meetingId: "new",
    ownerInstanceId: "new",
    voiceChannelId: "channel",
    textChannelId: "text",
    isAutoRecording: false,
    leaseExpiresAt: 200,
    createdAt: "now",
    updatedAt: "now",
    expiresAt: 300,
  };
  f.leases.set("guild", lease);
  expect(
    await f.repository.claimRecordingRecovery({
      history: f.row,
      lease: undefined,
      context,
      attemptId: "one",
    }),
  ).toBeUndefined();
  expect(f.leases.get("guild")).toEqual(lease);
});

test("recovery preserves terminal capture and refuses a foreign stage version", async () => {
  const f = await fixture();
  f.row.capture = {
    kind: "complete",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:01:00Z",
  };
  const claim = (await f.repository.claimRecordingRecovery({
    history: structuredClone(f.row),
    lease: undefined,
    context,
    attemptId: "capture",
  }))!;
  await expect(
    f.repository.updateRecordingRecovery(
      claim,
      { capture: { kind: "unknown" } },
      context.now,
    ),
  ).rejects.toThrow("cannot be relabeled");
  await expect(
    f.repository.updateRecordingRecovery(
      claim,
      { recovery: { ...claim.history.recovery!, executionVersion: 999 } },
      context.now,
    ),
  ).rejects.toThrow("identity");
});
test("durable cursor resumes across worker repositories and wraps for fair discovery", async () => {
  const records = new Map();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    ...history,
    channelId_timestamp: `channel#${String(i).padStart(3, "0")}`,
    status: "processing" as const,
    recovery: {
      disposition: "pending" as const,
      attempt: 0,
      executionVersion: 1,
      stage: "verification" as const,
      retry: { maxAttempts: 4, nextAttemptAt: null },
    },
  }));
  const histories = new Map([["guild", rows]]);
  const leases = new Map<string, ActiveMeetingLease>();
  const first = createMockDeploymentControlRepository(
    records,
    histories,
    leases,
  );
  await first.initializeControl(structuredClone(control));
  await first.writeRuntime(runtime("old"));
  const page = await first.discoverRecordingRecoveries();
  expect(page.keys).toHaveLength(100);
  expect(await first.saveRecoveryCursor(context, undefined, page.cursor)).toBe(
    true,
  );
  const restarted = createMockDeploymentControlRepository(
    records,
    histories,
    leases,
  );
  const state = await restarted.getRecord("ENV", "CONTROL");
  if (state?.recordType !== "control") throw new Error("Missing control");
  const next = await restarted.discoverRecordingRecoveries(
    state.recoveryScanCursor,
  );
  expect(next.keys).toHaveLength(100);
  expect(next.keys[0]).not.toEqual(page.keys[0]);
  expect(
    await restarted.saveRecoveryCursor(context, undefined, next.cursor),
  ).toBe(false);
  expect(
    await restarted.saveRecoveryCursor(context, page.cursor, next.cursor),
  ).toBe(true);
  const tail = await restarted.discoverRecordingRecoveries(next.cursor);
  expect(tail.keys).toHaveLength(1);
  expect(
    await restarted.saveRecoveryCursor(context, next.cursor, tail.cursor),
  ).toBe(true);
  expect((await restarted.discoverRecordingRecoveries()).keys).toEqual(
    page.keys,
  );
});
