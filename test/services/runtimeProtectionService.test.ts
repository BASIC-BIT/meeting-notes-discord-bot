/** @jest-environment node */
import { createRuntimeProtectionService } from "../../src/services/runtimeProtectionService";
import type { RuntimeIdentity } from "../../src/types/deploymentControl";

const identity: RuntimeIdentity = {
  kind: "ecs",
  instanceId: "instance",
  taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test/abc",
  imageDigest: `sha256:${"a".repeat(64)}`,
  candidateId: "release",
  protocolVersion: 1,
};
const now = () => Math.floor(Date.now() / 1000);
const response = (enabled = true) =>
  Response.json({
    protection: {
      TaskArn: identity.taskArn,
      ProtectionEnabled: enabled,
      ExpirationDate: enabled
        ? new Date(Date.now() + 600_000).toISOString()
        : null,
    },
  });

beforeEach(() => jest.useFakeTimers({ now: 1_000_000 }));
afterEach(() => jest.useRealTimers());

test("runnerLossDoesNotStopProtectionRenewal", async () => {
  const request = jest.fn(async () => response());
  const service = createRuntimeProtectionService({
    identity,
    agentUri: "http://169.254.170.2",
    request,
    now,
    onUnsafe: jest.fn(),
  });
  await service.start();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]).toEqual([
    "http://169.254.170.2/task-protection/v1/state",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ ProtectionEnabled: true, ExpiresInMinutes: 10 }),
    }),
  ]);
  expect(service.getConfirmation()?.expiresAt).toBe(1660);
  service.stop();
});

test.each([
  {
    protection: {
      TaskArn: "wrong-task",
      ProtectionEnabled: true,
      ExpirationDate: "1970-01-01T00:30:00Z",
    },
  },
  {
    protection: {
      TaskArn: identity.taskArn,
      ProtectionEnabled: false,
      ExpirationDate: null,
    },
  },
  { failure: { Reason: "TASK_NOT_VALID" } },
  { error: { Code: "AccessDeniedException" } },
])("rejects invalid agent confirmations %j", async (body) => {
  const service = createRuntimeProtectionService({
    identity,
    agentUri: "http://agent",
    request: jest.fn(async () => Response.json(body)),
    now,
    onUnsafe: jest.fn(),
  });
  await expect(service.start()).rejects.toThrow();
  expect(service.isSafe()).toBe(false);
  service.stop();
});

test("protectionUncertaintyFencesBeforeConfirmedExpiry", async () => {
  const unsafe = jest.fn();
  const request = jest
    .fn()
    .mockResolvedValueOnce(response())
    .mockRejectedValue(new Error("agent unavailable"));
  const service = createRuntimeProtectionService({
    identity,
    agentUri: "http://agent",
    request,
    now,
    onUnsafe: unsafe,
  });
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  await service.start();
  await jest.advanceTimersByTimeAsync(479_000);
  expect(unsafe).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(unsafe).toHaveBeenCalledTimes(1);
  expect(service.isSafe()).toBe(false);
  service.stop();
  warn.mockRestore();
});
