/** @jest-environment node */
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
import { createMeetingRecoveryWorker } from "../../src/services/meetingRecoveryWorkerService";
import { recoverMeeting } from "../../src/services/meetingRecoveryService";
import { recoverTranscript } from "../../src/services/meetingRecoveryContent";
import {
  createRuntimeLifecycle,
  installRuntimeLifecycle,
} from "../../src/services/runtimeLifecycleService";
import { createRuntimeProtectionService } from "../../src/services/runtimeProtectionService";
import {
  beginRuntimeWorkClaim,
  getRuntimeWorkAdmissionCheckpoints,
  fenceRuntimeWorkAdmissions,
} from "../../src/services/runtimeWorkAdmissionService";
import { recoveryFixture } from "./meetingRecoveryFixtures";
import { runtime, control } from "../deployment/controlFixtures";
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function verifyNewWorkerCursorContinuation(
  f: Awaited<ReturnType<typeof recoveryFixture>>,
) {
  const original = f.histories.get("guild")!;
  f.histories.set(
    "guild",
    Array.from({ length: 11 }, (_, index) => ({
      ...original[0],
      channelId_timestamp: `channel#${String(index).padStart(2, "0")}`,
      status: "processing" as const,
      recovery: undefined,
    })),
  );
  // A row may disappear between discovery and its per-key claim read. Each key
  // still has to be visited before the durable continuation can move past it.
  const reads = jest
    .spyOn(f.repository, "getMeetingHistory")
    .mockResolvedValue(undefined);
  const makeWorker = () =>
    createMeetingRecoveryWorker({
      repository: f.repository,
      begin: beginRuntimeWorkClaim,
      recover: recoverMeeting,
      now: () => Math.floor(Date.now() / 1000),
      content: {
        reader: f.reader,
        upload: f.upload,
        transcript: recoverTranscript,
        notes: async () => undefined,
        summaries: async () => ({}),
        send: async () => {
          throw new Error("Unexpected delivery");
        },
      },
    });
  try {
    const first = makeWorker();
    await first.poll();
    await first.stop();
    expect(reads).toHaveBeenCalledTimes(5);
    const state = await f.repository.getRecord("ENV", "CONTROL");
    expect(state).toMatchObject({
      recoveryScanCursor: {
        guildId: "guild",
        channelId_timestamp: "channel#04",
      },
    });
    const restarted = makeWorker();
    await restarted.poll();
    expect(reads).toHaveBeenCalledTimes(10);
    await restarted.poll();
    await restarted.stop();
    expect(
      new Set(reads.mock.calls.map(([key]) => key.channelId_timestamp)).size,
    ).toBe(11);
    expect(reads).toHaveBeenCalledTimes(11);
    const finished = await f.repository.getRecord("ENV", "CONTROL");
    expect(
      finished?.recordType === "control" && finished.recoveryScanCursor,
    ).toBeUndefined();
  } finally {
    reads.mockRestore();
    f.histories.set("guild", original);
  }
}

async function verifyCursorFailurePolling(
  f: Awaited<ReturnType<typeof recoveryFixture>>,
  lifecycle: ReturnType<typeof createRuntimeLifecycle>,
  mode: "exact" | "unavailable" | "different" | "read",
) {
  const original = f.histories.get("guild")!;
  const control = await f.repository.getRecord("ENV", "CONTROL");
  if (control?.recordType !== "control") throw new Error("fixture");
  const baseline = lifecycle.getWorkCounts().pending_admission;
  f.histories.set(
    "guild",
    Array.from({ length: 11 }, (_, index) => ({
      ...original[0],
      channelId_timestamp: `cursor-${mode}#${String(index).padStart(2, "0")}`,
      status: "processing" as const,
      recovery: undefined,
    })),
  );
  const reads = jest
    .spyOn(f.repository, "getMeetingHistory")
    .mockResolvedValue(undefined);
  if (mode === "read")
    reads.mockRejectedValueOnce(new Error("read failed before any mutation"));
  const get = f.repository.getRecord.bind(f.repository);
  const readback = jest.spyOn(f.repository, "getRecord");
  const save = f.repository.saveRecoveryCursor.bind(f.repository);
  const writes = jest.spyOn(f.repository, "saveRecoveryCursor");
  if (mode !== "read")
    writes.mockImplementationOnce(async (...args) => {
      const result = await save(...args);
      expect(result).toBe(true);
      if (mode === "unavailable")
        readback.mockRejectedValueOnce(new Error("readback unavailable"));
      if (mode === "different") {
        const current = f.records.get(JSON.stringify(["ENV", "CONTROL"]));
        current.coordinatorToken = "later-coordinator";
      }
      throw new Error("cursor committed but response lost");
    });
  const worker = createMeetingRecoveryWorker({
    repository: f.repository,
    begin: beginRuntimeWorkClaim,
    recover: recoverMeeting,
    now: () => Math.floor(Date.now() / 1000),
    content: {
      reader: f.reader,
      upload: f.upload,
      transcript: recoverTranscript,
      notes: async () => undefined,
      summaries: async () => ({}),
      send: async () => {
        throw new Error("Unexpected send");
      },
    },
  });
  try {
    await worker.poll();
    expect(reads).toHaveBeenCalledTimes(5);
    expect(lifecycle.getWorkCounts().pending_admission).toBe(
      baseline + (mode === "unavailable" || mode === "different" ? 1 : 0),
    );
    await worker.poll();
    expect(reads).toHaveBeenCalledTimes(10);
    await worker.poll();
    expect(
      new Set(reads.mock.calls.map(([key]) => key.channelId_timestamp)).size,
    ).toBe(11);
    if (mode === "different") {
      expect(writes).toHaveBeenCalledTimes(1);
      expect(lifecycle.getWorkCounts().pending_admission).toBe(baseline + 1);
    } else expect(lifecycle.getWorkCounts().pending_admission).toBe(baseline);
    if (mode === "read") {
      await worker.poll();
      expect(
        reads.mock.calls.filter(([key]) =>
          key.channelId_timestamp.endsWith("#00"),
        ),
      ).toHaveLength(2);
    }
  } finally {
    await worker.stop();
    reads.mockRestore();
    writes.mockRestore();
    readback.mockRestore();
    f.histories.set("guild", original);
    f.records.set(JSON.stringify(["ENV", "CONTROL"]), control);
    expect(await get("ENV", "CONTROL")).toEqual(control);
  }
}

test("actual compatible replacement discovers recovery, owns renewal tails, seals synchronously and retains unknown delivery", async () => {
  jest.useFakeTimers({ now: Date.parse("2026-10-14T00:00:00Z") });
  const f = await recoveryFixture();
  const history = f.histories.get("guild")![0];
  history.ownerInstanceId = "old";
  history.executionVersion = 1;
  history.recovery = undefined;
  f.leases.clear();
  const old = runtime("old");
  old.readiness.expiresAt = f.now - 1;
  old.workCounts = {
    recording: 1,
    pending_admission: 0,
    finalization: 0,
    personal_processing: 0,
    recovery_processing: 0,
    voice_operation: 1,
    ancillary_delivery: 0,
  };
  const candidate = runtime("replacement", "candidate");
  if (candidate.identity.kind !== "ecs" || old.identity.kind !== "ecs")
    throw new Error("fixture");
  candidate.identity.candidateId = old.identity.candidateId;
  const state = {
    ...control,
    coordinatorExpiresAt: f.now - 1,
    deployment: {
      runToken: "completed-rollout",
      cluster: "fixture",
      service: "fixture",
      family: "fixture",
      tablePrefix: "fixture",
      candidateId: "old",
      image: "fixture",
      runtimeMode: "all" as const,
      phase: "complete" as const,
      originalGeneration: 6,
      originalMembers: [runtime("previous").identity],
      outgoing: runtime("previous").identity,
      previousTaskDefinition: "fixture:1",
      taskDefinition: "fixture:2",
      candidate: old.identity,
      updatedAt: f.now - 10,
    },
  };
  f.records.set(JSON.stringify(["ENV", "CONTROL"]), structuredClone(state));
  f.records.set(JSON.stringify(["ENV", "RUNTIME#old"]), structuredClone(old));
  const protection = createRuntimeProtectionService({
    identity: candidate.identity,
    agentUri: "http://fixture.invalid",
    request: async () =>
      new Response(
        JSON.stringify({
          protection: {
            TaskArn:
              candidate.identity.kind === "ecs"
                ? candidate.identity.taskArn
                : "",
            ProtectionEnabled: true,
            ExpirationDate: new Date((f.now + 600) * 1000).toISOString(),
          },
        }),
      ),
    onUnsafe: () => {},
    now: () => Math.floor(Date.now() / 1000),
  });
  const lifecycle = createRuntimeLifecycle({
    identity: candidate.identity,
    repository: f.repository,
    protection,
    checkpointAndFence: async () => {},
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
  });
  installRuntimeLifecycle(lifecycle);
  await lifecycle.start();
  await verifyNewWorkerCursorContinuation(f);
  expect(
    (await lifecycle.getRuntimeAdmissionContext()).authorizedGeneration,
  ).toBe(8);
  expect(await f.repository.getRecord("ENV", "RUNTIME#old")).toMatchObject({
    role: "draining",
    workCounts: { recording: 1, voice_operation: 1 },
  });
  const entered = barrier(),
    generation = barrier(),
    renewed = barrier(),
    renewal = barrier();
  const originalRenew = f.repository.renewRecordingRecovery;
  jest
    .spyOn(f.repository, "renewRecordingRecovery")
    .mockImplementationOnce(async (...args) => {
      renewed.resolve();
      await renewal.promise;
      return originalRenew(...args);
    });
  const send = jest.fn(async () => {
    throw new Error("unknown send ACK");
  });
  const worker = createMeetingRecoveryWorker({
    repository: f.repository,
    begin: beginRuntimeWorkClaim,
    recover: recoverMeeting,
    now: () => Math.floor(Date.now() / 1000),
    content: {
      reader: f.reader,
      upload: f.upload,
      transcript: recoverTranscript,
      send,
      notes: async (input) => {
        entered.resolve();
        await generation.promise;
        input.notesText = "Verified saved conversation";
        input.processing = { ...input.processing, notes: "generated" };
        return input.notesText;
      },
      summaries: async (input) => {
        input.summarySentence = "Saved summary";
        input.processing = { ...input.processing, summary: "generated" };
        return { summarySentence: input.summarySentence };
      },
    },
  });
  const polling = worker.poll();
  expect(lifecycle.getWorkCounts().pending_admission).toBe(1);
  await entered.promise;
  expect(lifecycle.getWorkCounts().recovery_processing).toBe(1);
  await jest.advanceTimersByTimeAsync(10000);
  await renewed.promise;
  const stopped = worker.stop();
  let finished = false;
  void stopped.then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  generation.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  renewal.resolve();
  await polling;
  await stopped;
  expect(send).toHaveBeenCalledTimes(1);
  expect(lifecycle.getWorkCounts().recovery_processing).toBe(1);
  expect(
    getRuntimeWorkAdmissionCheckpoints().filter(
      (row) => row.domain === "recovery",
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ fenced: true, localSettled: true }),
    ]),
  );
  await worker.poll();
  expect(send).toHaveBeenCalledTimes(1);
  for (const mode of ["exact", "unavailable", "read", "different"] as const)
    await verifyCursorFailurePolling(f, lifecycle, mode);
  fenceRuntimeWorkAdmissions();
  await lifecycle.shutdown();
  jest.useRealTimers();
});
