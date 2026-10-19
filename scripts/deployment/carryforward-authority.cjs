"use strict";
const assert = require("node:assert/strict");
const { controlAuthority } = require("./carryforward-state.cjs");
const { createRuntimeProof } = require("./runtime-proof.cjs");
const { createRouting, action } = require("./routing.cjs");
const { CoordinatorFailure } = require("./coordinator-aws.cjs");
function createCarryforwardAuthority({
  aws,
  inspector,
  config,
  env,
  types,
  now,
  runToken,
  claim,
  recovery,
}) {
  const proof = createRuntimeProof({ aws, config, types, now, diagnostic: {} });
  const routing = createRouting({
    aws,
    config,
    env,
    failure: (category, message) => new CoordinatorFailure(category, message),
  });
  function own(current) {
    assert.equal(current.coordinatorToken, runToken);
    assert.equal(current.coordinatorEpoch, claim.next.coordinatorEpoch);
    const d = current.deployment;
    for (const key of [
      "runToken",
      "cluster",
      "service",
      "family",
      "tablePrefix",
      "candidateId",
      "image",
      "outgoing",
      "originalMembers",
      "originalGeneration",
      "previousTaskDefinition",
      "runtimeMode",
    ])
      assert.deepEqual(d[key], claim.next.deployment[key]);
    const members = Object.values(current.servingMembers);
    assert.equal(members.length, 1);
    const sourceSelected = types.sameRuntimeIdentity(
      members[0],
      claim.archive.source,
    );
    assert.ok(
      sourceSelected || types.sameRuntimeIdentity(members[0], d.candidate),
    );
    return [
      ...new Map(
        [...members, ...(d.candidate ? [d.candidate] : [])].map((identity) => [
          identity.instanceId,
          identity,
        ]),
      ).values(),
    ];
  }
  async function assertBeforeWrite(operation, input) {
    assert.deepEqual(
      await inspector.read(inspector.archiveKey, "ARCHIVE"),
      claim.archive,
    );
    assert.deepEqual(await inspector.read(recovery.pk, "RECOVERY"), recovery);
    const current = await inspector.control();
    const identities = own(current);
    const expirations = await Promise.all(
      identities.map((identity) => proof.protectedTask(identity)),
    );
    if (operation === "modify-listener") {
      const r = current.deployment.routing;
      assert.equal(r.state, "forward_submitted");
      assert.equal(input.ListenerArn, r.listenerArn);
      assert.deepEqual(input.DefaultActions, action(r, true));
      const response = await aws("ecs", "describe-services", {
        cluster: config.cluster,
        services: [config.service],
      });
      assert.ok(!response.failures?.length && response.services?.length === 1);
      await routing.validate(
        current,
        response.services[0],
        current.deployment.candidate,
      );
      await routing.assertAction(r, false);
    }
    const late = await inspector.control();
    assert.deepEqual(controlAuthority(late), controlAuthority(current));
    const rows = await Promise.all(
      identities.map(async (identity) =>
        types.runtimeRecordSchema.parse(
          await inspector.read("ENV", "RUNTIME#" + identity.instanceId),
        ),
      ),
    );
    for (const [index, row] of rows.entries()) {
      assert.ok(
        proof.ready(row, late, identities[index], late.deployment.runtimeMode),
      );
      assert.equal(row.authorizedGeneration, late.servingGeneration);
      assert.equal(
        row.role,
        late.servingMembers[identities[index].instanceId]
          ? "serving"
          : "candidate",
      );
      assert.ok(!row.retirementRequest && !row.retirementAcknowledgment);
    }
    assert.ok(
      late.coordinatorExpiresAt > now(),
      "Coordinator authority expired before provider mutation",
    );
    assert.ok(expirations.every((expiry) => expiry > now() + 120));
  }
  return { assertBeforeWrite };
}
module.exports = { createCarryforwardAuthority };
