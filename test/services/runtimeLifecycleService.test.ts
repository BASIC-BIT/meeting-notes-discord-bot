/** @jest-environment node */
import { createRuntimeLifecycle } from "../../src/services/runtimeLifecycleService";
import { createRuntimeProtectionService } from "../../src/services/runtimeProtectionService";
import { createMockDeploymentControlRepository } from "../../src/repositories/deploymentControlRepository";
import type { RuntimeIdentity } from "../../src/types/deploymentControl";

const identity: RuntimeIdentity = {
  kind: "local",
  instanceId: "candidate",
  localId: "fixture",
  protocolVersion: 1,
};
const now = () => Math.floor(Date.now() / 1000);
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const repository = createMockDeploymentControlRepository();
  await repository.initializeControl({
    pk: "ENV",
    sk: "CONTROL",
    recordType: "control",
    protocolVersion: 1,
    coordinatorToken: "coordinator",
    coordinatorEpoch: 1,
    coordinatorExpiresAt: 2000,
    servingGeneration: 0,
    servingMembers: {},
  });
  const protection = createRuntimeProtectionService({
    identity,
    now,
    onUnsafe: jest.fn(),
  });
  const lifecycle = createRuntimeLifecycle({
    identity,
    repository,
    protection,
    now,
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
    checkpointAndFence: jest.fn(),
  });
  await lifecycle.start();
  return { lifecycle, repository, protection };
}
async function promote(
  repository: ReturnType<typeof createMockDeploymentControlRepository>,
  candidate = identity,
  generation = 1,
) {
  const control = await repository.getRecord("ENV", "CONTROL");
  if (control?.recordType !== "control") throw new Error("missing control");
  expect(
    await repository.promote({
      candidateRuntimeMode: "all",
      coordinatorToken: "coordinator",
      coordinatorEpoch: 1,
      expectedServingGeneration: generation - 1,
      expectedServingMembers: Object.values(control.servingMembers),
      candidate,
      proposedGeneration: generation,
      now: now(),
    }),
  ).toBe("applied");
}
async function replace(
  repository: ReturnType<typeof createMockDeploymentControlRepository>,
) {
  const row = await repository.getRecord("ENV", "RUNTIME#candidate");
  if (row?.recordType !== "runtime") throw new Error("missing fixture");
  const nextIdentity = { ...identity, instanceId: "replacement" };
  await repository.writeRuntime({
    ...row,
    sk: "RUNTIME#replacement",
    identity: nextIdentity,
    role: "candidate",
    readiness: { ...row.readiness, identity: nextIdentity },
    protection: { ...row.protection, identity: nextIdentity },
  });
  await promote(repository, nextIdentity, 2);
}
beforeEach(() => jest.useFakeTimers({ now: 1_000_000 }));
afterEach(() => jest.useRealTimers());

test("warmRuntimeOwnsNoWork", async () => {
  const { lifecycle } = await fixture();
  expect(() => lifecycle.beginRuntimeWork("pending_admission")).toThrow();
  await expect(lifecycle.getRuntimeAdmissionContext()).rejects.toThrow();
  const warmClaims = Object.values(lifecycle.getWorkCounts()).filter(
    (count) => count > 0,
  );
  expect(warmClaims).toHaveLength(0);
  lifecycle.stop();
});

test("readinessRequiresGatewayAndRequiredDependencies", async () => {
  const { lifecycle, repository } = await fixture();
  lifecycle.registerSafetyHandler(undefined);
  await lifecycle.refreshRuntimeReadiness();
  expect(
    await repository.promote({
      candidateRuntimeMode: "all",
      coordinatorToken: "coordinator",
      coordinatorEpoch: 1,
      expectedServingGeneration: 0,
      expectedServingMembers: [],
      candidate: identity,
      proposedGeneration: 1,
      now: now(),
    }),
  ).toBe("stale");
  lifecycle.stop();
});

test("retirementCannotUnprotectOtherOwnedWork", async () => {
  const { lifecycle, repository, protection } = await fixture();
  await promote(repository);
  await lifecycle.getRuntimeAdmissionContext();
  const recording = lifecycle.beginRuntimeWork("recording");
  const upload = lifecycle.beginRuntimeWork("personal_processing");
  recording.settle();
  recording.settle();
  await replace(repository);
  expect(
    (await lifecycle.prepareRuntimeRetirement({ retirementEpoch: 1 })).kind,
  ).toBe("busy");
  expect(protection.getConfirmation()).toBeDefined();
  upload.settle();
  expect(
    (await lifecycle.prepareRuntimeRetirement({ retirementEpoch: 1 })).kind,
  ).toBe("retired");
  expect(protection.getConfirmation()).toBeUndefined();
  lifecycle.stop();
});

test("reauthorizationWaitsForPendingProtectionRelease", async () => {
  const { repository, lifecycle: unused } = await fixture();
  unused.stop();
  const ecs: RuntimeIdentity = {
    kind: "ecs",
    instanceId: "ecs",
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test/abc",
    imageDigest: `sha256:${"a".repeat(64)}`,
    candidateId: "release",
    protocolVersion: 1,
  };
  const releaseStarted = barrier<void>();
  const release = barrier<Response>();
  let unprotectCalls = 0;
  const request: typeof fetch = jest.fn(async (_url, init) => {
    if (init?.body === JSON.stringify({ ProtectionEnabled: false })) {
      unprotectCalls++;
      releaseStarted.resolve();
      return release.promise;
    }
    return Response.json({
      protection: {
        TaskArn: ecs.taskArn,
        ProtectionEnabled: true,
        ExpirationDate: new Date(Date.now() + 600_000).toISOString(),
      },
    });
  });
  const protection = createRuntimeProtectionService({
    identity: ecs,
    agentUri: "http://agent",
    request,
    now,
    onUnsafe: jest.fn(),
  });
  const lifecycle = createRuntimeLifecycle({
    identity: ecs,
    repository,
    protection,
    now,
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
    checkpointAndFence: jest.fn(),
  });
  await lifecycle.start();
  await promote(repository, ecs);
  await lifecycle.getRuntimeAdmissionContext();
  const work = lifecycle.beginRuntimeWork("personal_processing");
  // Publish a fresh candidate for the next generation before retiring ECS.
  const old = await repository.getRecord("ENV", "RUNTIME#candidate");
  if (old?.recordType !== "runtime") throw new Error("missing fixture");
  await repository.writeRuntime({
    ...old,
    readiness: { ...old.readiness, observedGeneration: 1 },
  });
  await promote(repository, identity, 2);
  await lifecycle.prepareRuntimeRetirement({ retirementEpoch: 1 });
  const unprotectCallsWhileOwnedWorkRemains = unprotectCalls;
  expect(unprotectCallsWhileOwnedWorkRemains).toBe(0);
  work.settle();
  const retirement = lifecycle.prepareRuntimeRetirement({ retirementEpoch: 1 });
  await releaseStarted.promise;
  let rearmed = false;
  const reauthorization = lifecycle
    .reauthorizeRuntime({ retirementEpoch: 1 })
    .then(() => {
      rearmed = true;
    });
  const promotedWhileReleasePending =
    (await repository.promote({
      candidateRuntimeMode: "all",
      coordinatorToken: "coordinator",
      coordinatorEpoch: 1,
      expectedServingGeneration: 2,
      expectedServingMembers: [identity],
      candidate: ecs,
      proposedGeneration: 3,
      now: now(),
    })) === "applied";
  expect(promotedWhileReleasePending).toBe(false);
  expect(rearmed).toBe(false);
  release.resolve(
    Response.json({
      protection: {
        TaskArn: ecs.taskArn,
        ProtectionEnabled: false,
        ExpirationDate: null,
      },
    }),
  );
  expect((await retirement).kind).toBe("retired");
  await reauthorization;
  await promote(repository, ecs, 3);
  expect(
    (await lifecycle.getRuntimeAdmissionContext()).authorizedGeneration,
  ).toBe(3);
  expect(protection.isSafe()).toBe(true);
  lifecycle.stop();
});

test.each(["gatewayReady", "cacheReady", "dependenciesReady"] as const)(
  "missing %s prevents promotion",
  async (missing) => {
    const { lifecycle: unused, repository } = await fixture();
    unused.stop();
    const candidate = { ...identity, instanceId: "not-ready" };
    const protection = createRuntimeProtectionService({
      identity: candidate,
      now,
      onUnsafe: jest.fn(),
    });
    const lifecycle = createRuntimeLifecycle({
      identity: candidate,
      repository,
      protection,
      now,
      probeReadiness: async () => ({
        gatewayReady: true,
        cacheReady: true,
        dependenciesReady: true,
        [missing]: false,
      }),
      checkpointAndFence: jest.fn(),
    });
    await lifecycle.start();
    expect(
      await repository.promote({
        candidateRuntimeMode: "all",
        coordinatorToken: "coordinator",
        coordinatorEpoch: 1,
        expectedServingGeneration: 0,
        expectedServingMembers: [],
        candidate,
        proposedGeneration: 1,
        now: now(),
      }),
    ).toBe("stale");
    lifecycle.stop();
  },
);

test("staleReadinessPreventsPromotion", async () => {
  const { lifecycle, repository } = await fixture();
  lifecycle.stop();
  jest.setSystemTime(1_031_000);
  expect(
    await repository.promote({
      candidateRuntimeMode: "all",
      coordinatorToken: "coordinator",
      coordinatorEpoch: 1,
      expectedServingGeneration: 0,
      expectedServingMembers: [],
      candidate: identity,
      proposedGeneration: 1,
      now: now(),
    }),
  ).toBe("stale");
});

test("retained API runtime adopts only its explicitly authorized generation", async () => {
  const { lifecycle: bot, repository } = await fixture();
  await promote(repository);
  await bot.getRuntimeAdmissionContext();
  const recording = bot.beginRuntimeWork("recording");
  const apiIdentity = { ...identity, instanceId: "api" };
  const apiProtection = createRuntimeProtectionService({
    identity: apiIdentity,
    now,
    onUnsafe: jest.fn(),
  });
  const api = createRuntimeLifecycle({
    identity: apiIdentity,
    runtimeMode: "api",
    repository,
    protection: apiProtection,
    now,
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
    checkpointAndFence: jest.fn(),
  });
  await api.start();
  expect(
    await repository.promote({
      coordinatorToken: "coordinator",
      coordinatorEpoch: 1,
      expectedServingGeneration: 1,
      expectedServingMembers: [identity],
      candidate: apiIdentity,
      candidateRuntimeMode: "api",
      retainedMembers: [identity],
      proposedGeneration: 2,
      now: now(),
    }),
  ).toBe("applied");
  expect((await api.getRuntimeAdmissionContext()).authorizedGeneration).toBe(2);
  const upload = api.beginRuntimeWork("personal_processing");
  const nextIdentity = { ...identity, instanceId: "replacement" };
  const nextProtection = createRuntimeProtectionService({
    identity: nextIdentity,
    now,
    onUnsafe: jest.fn(),
  });
  const next = createRuntimeLifecycle({
    identity: nextIdentity,
    repository,
    protection: nextProtection,
    now,
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
    checkpointAndFence: jest.fn(),
  });
  await next.start();
  expect(
    await repository.promote({
      candidateRuntimeMode: "all",
      coordinatorToken: "coordinator",
      coordinatorEpoch: 1,
      expectedServingGeneration: 2,
      expectedServingMembers: [identity, apiIdentity],
      candidate: nextIdentity,
      retainedMembers: [apiIdentity],
      proposedGeneration: 3,
      now: now(),
    }),
  ).toBe("applied");
  expect((await api.getRuntimeAdmissionContext()).authorizedGeneration).toBe(3);
  await expect(bot.getRuntimeAdmissionContext()).rejects.toThrow();
  expect(() => bot.beginRuntimeWork("pending_admission")).toThrow();
  recording.transition("finalization");
  expect(
    (await bot.prepareRuntimeRetirement({ retirementEpoch: 1 })).kind,
  ).toBe("busy");
  expect(api.getWorkCounts().personal_processing).toBe(1);
  recording.settle();
  upload.settle();
  bot.stop();
  api.stop();
  next.stop();
});

test("protection loss closes admission and fences owned API work before expiry", async () => {
  const { lifecycle: unused, repository } = await fixture();
  unused.stop();
  const ecs: RuntimeIdentity = {
    kind: "ecs",
    instanceId: "bounded",
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test/bounded",
    imageDigest: `sha256:${"a".repeat(64)}`,
    candidateId: "release",
    protocolVersion: 1,
  };
  const request = jest
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        protection: {
          TaskArn: ecs.taskArn,
          ProtectionEnabled: true,
          ExpirationDate: "1970-01-01T00:26:40Z",
        },
      }),
    )
    .mockRejectedValue(new Error("offline"));
  const protection = createRuntimeProtectionService({
    identity: ecs,
    agentUri: "http://agent",
    request,
    now,
    onUnsafe: jest.fn(),
  });
  const checkpointAndFence = jest.fn(async () => undefined);
  const lifecycle = createRuntimeLifecycle({
    identity: ecs,
    repository,
    protection,
    now,
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
    checkpointAndFence,
  });
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  await lifecycle.start();
  await promote(repository, ecs);
  await lifecycle.getRuntimeAdmissionContext();
  const work = lifecycle.beginRuntimeWork("personal_processing");
  await jest.advanceTimersByTimeAsync(480_000);
  expect(checkpointAndFence).toHaveBeenCalledTimes(1);
  expect(() => lifecycle.beginRuntimeWork("pending_admission")).toThrow();
  expect(lifecycle.getReadiness()?.expiresAt).toBeLessThanOrEqual(1480);
  work.settle();
  lifecycle.stop();
  warn.mockRestore();
});

test("uncertain release cannot reauthorize", async () => {
  const { lifecycle: unused, repository } = await fixture();
  unused.stop();
  const ecs: RuntimeIdentity = {
    kind: "ecs",
    instanceId: "uncertain",
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test/uncertain",
    imageDigest: `sha256:${"a".repeat(64)}`,
    candidateId: "release",
    protocolVersion: 1,
  };
  const request = jest
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        protection: {
          TaskArn: ecs.taskArn,
          ProtectionEnabled: true,
          ExpirationDate: "1970-01-01T00:26:40Z",
        },
      }),
    )
    .mockRejectedValue(new Error("release timed out"));
  const protection = createRuntimeProtectionService({
    identity: ecs,
    agentUri: "http://agent",
    request,
    now,
    onUnsafe: jest.fn(),
  });
  const lifecycle = createRuntimeLifecycle({
    identity: ecs,
    repository,
    protection,
    now,
    probeReadiness: async () => ({
      gatewayReady: true,
      cacheReady: true,
      dependenciesReady: true,
    }),
    checkpointAndFence: jest.fn(),
  });
  await lifecycle.start();
  expect(
    (await lifecycle.prepareRuntimeRetirement({ retirementEpoch: 1 })).kind,
  ).toBe("uncertain");
  await expect(
    lifecycle.reauthorizeRuntime({ retirementEpoch: 1 }),
  ).rejects.toThrow("not been confirmed");
  expect(request).toHaveBeenCalledTimes(2);
  lifecycle.stop();
});
