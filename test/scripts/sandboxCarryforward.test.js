/** @jest-environment node */
import { expect, test } from "@jest/globals";
import { carryforwardFixture } from "../deployment/fixtures/carryforwardFixture";
import { carryforwardSandbox } from "../../scripts/deployment/carryforward-sandbox.cjs";
import { bindingHash } from "../../scripts/deployment/binding-hash.cjs";
import { controlAuthority } from "../../scripts/deployment/carryforward-state.cjs";
const writes = (f) =>
  f.calls
    .slice(f.before)
    .filter((c) =>
      [
        "update-item",
        "transact-write-items",
        "register-task-definition",
        "update-service",
        "modify-listener",
      ].includes(c.operation),
    );
async function bind(f) {
  const result = await carryforwardSandbox({ ...f.options, mode: "inspect" });
  f.options.env.CARRYFORWARD_BINDING_SHA256 = result.bindingSha256;
  return result;
}
test("carryforward inspection is metadata-only and binds original recovery and exact reviewed template", async () => {
  const f = carryforwardFixture();
  expect(await bind(f)).toMatchObject({
    kind: "inspection",
    binding: {
      kind: "sandbox_historical_carryforward",
      source: f.oldIdentity,
      preparedDefinitionSha256: f.manifest.preparedDefinitionSha256,
    },
  });
  expect(writes(f)).toEqual([]);
});

test("the current native source revision must match the original acknowledged candidate", async () => {
  const f = carryforwardFixture();
  f.state.ctl.deployment.routing.candidateRevision = "foreign-revision";
  f.manifest.controlSha256 = bindingHash(controlAuthority(f.state.ctl));
  f.bind();
  await expect(bind(f)).rejects.toThrow();
  expect(writes(f)).toEqual([]);
});
test.each([false, true])(
  "one-use archive hands off to normal genuine source retirement, including lost claim acknowledgment=%s",
  async (loseAck) => {
    const f = carryforwardFixture();
    await bind(f);
    f.carry.loseAck = loseAck;
    const oldLoss = structuredClone(f.carry.recovery),
      lostRuntime = structuredClone(f.carry.historical);
    expect(
      await carryforwardSandbox({ ...f.options, mode: "carryforward" }),
    ).toMatchObject({
      kind: "carryforward_complete",
      settlement: "lost_owner_settlement_pending",
    });
    expect(f.state.ctl.deployment.phase).toBe("complete");
    expect(f.state.ctl.deployment.outgoing).toEqual(f.oldIdentity);
    expect(
      f.state.rows.old.retirementAcknowledgment.request.coordinatorToken,
    ).toBe("901-1");
    expect(f.carry.recovery).toEqual(oldLoss);
    expect(f.carry.historical).toEqual(lostRuntime);
    expect(f.carry.archive.originalControl.deployment.phase).toBe("promoted");
    const before = writes(f).length;
    await expect(
      carryforwardSandbox({ ...f.options, mode: "carryforward" }),
    ).rejects.toThrow();
    expect(writes(f)).toHaveLength(before);
  },
);
test.each([
  "receipt",
  "control",
  "template",
  "competing",
  "pending",
  "binding",
])("changed %s refuses before claim and service mutation", async (scenario) => {
  const f = carryforwardFixture();
  await bind(f);
  if (scenario === "receipt") f.carry.recovery.updatedAt++;
  if (scenario === "control") f.state.ctl.coordinatorEpoch++;
  if (scenario === "template")
    f.carry.template.volumes.push({ name: "unreviewed" });
  if (scenario === "competing")
    f.options.writerInventory.assertExclusive.mockRejectedValue(
      new Error("competing writer"),
    );
  if (scenario === "pending") f.svc.pendingCount = 1;
  if (scenario === "binding")
    f.options.env.CARRYFORWARD_BINDING_SHA256 = "0".repeat(64);
  await expect(
    carryforwardSandbox({ ...f.options, mode: "carryforward" }),
  ).rejects.toThrow();
  expect(writes(f)).toEqual([]);
  expect(f.carry.archive).toBeUndefined();
});
test("a slow final writer read cannot outlive native protection before the atomic handoff", async () => {
  const f = carryforwardFixture();
  await bind(f);
  let reads = 0;
  f.options.writerInventory.assertExclusive.mockImplementation(async () => {
    if (++reads === 3) f.carry.advance(1000);
    return { competing: 0 };
  });
  await expect(
    carryforwardSandbox({ ...f.options, mode: "carryforward" }),
  ).rejects.toThrow("Native protection expired");
  expect(writes(f)).toEqual([]);
});
test("unknown listener acknowledgment preserves the submitted fence and forbids a second invocation", async () => {
  const f = carryforwardFixture();
  await bind(f);
  f.traffic.unknown = true;
  await expect(
    carryforwardSandbox({ ...f.options, mode: "carryforward" }),
  ).rejects.toThrow();
  expect(f.state.ctl.deployment.routing.state).toBe("forward_submitted");
  expect(f.state.rows.old.retirementAcknowledgment).toBeUndefined();
  expect(f.carry.recovery.settlement).toBe("lost_owner_settlement_pending");
  const submitted = f.calls.filter(
    (c) => c.operation === "modify-listener",
  ).length;
  await expect(
    carryforwardSandbox({ ...f.options, mode: "carryforward" }),
  ).rejects.toThrow();
  expect(f.calls.filter((c) => c.operation === "modify-listener")).toHaveLength(
    submitted,
  );
});
test("ongoing source work is retained after traffic moves until its own genuine acknowledgment", async () => {
  const f = carryforwardFixture();
  await bind(f);
  f.state.rows.old.workCounts.recording = 1;
  f.state.retirementAcknowledged = false;
  let observedBusy = false;
  f.state.onSleep = () => {
    if (!f.state.rows.old.retirementRequest || observedBusy) return;
    expect(f.state.ctl.deployment.routing.state).toBe("candidate");
    expect(f.state.rows.old.retirementAcknowledgment).toBeUndefined();
    expect(f.state.rows.old.workCounts.recording).toBe(1);
    observedBusy = true;
    f.state.rows.old.workCounts.recording = 0;
    f.state.rows.old.role = "retired";
    f.state.rows.old.retirementAcknowledgment = {
      request: f.state.rows.old.retirementRequest,
      retiredAt: f.options.now(),
    };
  };
  expect(
    await carryforwardSandbox({ ...f.options, mode: "carryforward" }),
  ).toMatchObject({ kind: "carryforward_complete" });
  expect(observedBusy).toBe(true);
});
test("loss of the exclusive writer window after claim preserves archive and prevents service mutation", async () => {
  const f = carryforwardFixture();
  await bind(f);
  f.carry.afterClaim = () =>
    f.options.writerInventory.assertExclusive.mockRejectedValue(
      new Error("competing operation"),
    );
  await expect(
    carryforwardSandbox({ ...f.options, mode: "carryforward" }),
  ).rejects.toThrow();
  expect(f.carry.archive).toBeDefined();
  expect(f.state.ctl.deployment.phase).toBe("preparing");
  expect(
    f.calls.some((c) =>
      [
        "register-task-definition",
        "update-service",
        "modify-listener",
      ].includes(c.operation),
    ),
  ).toBe(false);
});
test.each([
  "readiness",
  "protection",
  "foreign_listener",
  "foreign_identity",
  "coordinator_expiry",
])(
  "late %s loss during writer inventory cannot reach listener mutation",
  async (scenario) => {
    const f = carryforwardFixture();
    await bind(f);
    let injected = false;
    f.options.writerInventory.assertExclusive.mockImplementation(async () => {
      if (
        !injected &&
        f.state.ctl.deployment.routing.state === "forward_submitted"
      ) {
        injected = true;
        if (scenario === "readiness")
          f.state.rows.new.readiness.dependenciesReady = false;
        if (scenario === "protection") f.state.protected = false;
        if (scenario === "foreign_listener") f.traffic.actions = [];
        if (scenario === "foreign_identity") {
          const identity = {
            ...f.state.rows.new.identity,
            instanceId: "foreign",
            taskArn: f.candidateIdentity.taskArn + "-foreign",
          };
          Object.assign(f.state.rows.new, { identity, role: "candidate" });
          f.state.rows.new.readiness.identity = identity;
          f.state.rows.new.protection.identity = identity;
        }
        if (scenario === "coordinator_expiry") {
          f.carry.advance(
            f.state.ctl.coordinatorExpiresAt - f.options.now() + 1,
          );
          for (const row of Object.values(f.state.rows)) {
            row.heartbeatAt = f.options.now();
            row.readiness.provenAt = f.options.now();
            row.readiness.expiresAt = f.options.now() + 30;
            row.protection.expiresAt = f.options.now() + 600;
          }
        }
      }
      return { competing: 0 };
    });
    await expect(
      carryforwardSandbox({ ...f.options, mode: "carryforward" }),
    ).rejects.toThrow();
    expect(injected).toBe(true);
    expect(
      f.calls.filter((c) => c.operation === "modify-listener"),
    ).toHaveLength(0);
    expect(f.state.ctl.deployment.routing.state).toBe("forward_submitted");
  },
);
test("the actual OIDC session must belong to the execution run, not only an independently named valid session", async () => {
  const f = carryforwardFixture();
  f.options.env.GITHUB_RUN_ID = "902";
  await expect(
    carryforwardSandbox({ ...f.options, mode: "inspect" }),
  ).rejects.toThrow();
  expect(writes(f)).toEqual([]);
});
