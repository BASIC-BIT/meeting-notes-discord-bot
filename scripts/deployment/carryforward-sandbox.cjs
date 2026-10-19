"use strict";
const assert = require("node:assert/strict");
const {
  awsCli,
  createCoordinator,
  configuration,
} = require("./coordinator.cjs");
const { assertSandboxIdentity } = require("./assert-sandbox-identity.cjs");
const { readCarryforwardManifest } = require("./carryforward-manifest.cjs");
const { createWriterInventory } = require("./carryforward-writers.cjs");
const { createCarryforwardAuthority } = require("./carryforward-authority.cjs");
const {
  createCarryforwardInspection,
} = require("./carryforward-inspection.cjs");
const {
  buildCarryforward,
  commitCarryforward,
} = require("./carryforward-state.cjs");
const { runRecoveryCli } = require("./recover-sandbox.cjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function carryforwardSandbox(options = {}) {
  const env = options.env ?? process.env,
    now = options.now ?? (() => Math.floor(Date.now() / 1000));
  assert.ok(
    !Object.keys(env).some(
      (key) => key.startsWith("AWS_ENDPOINT_URL") && env[key],
    ),
  );
  assert.ok(["inspect", "carryforward"].includes(options.mode));
  const { manifest, hash, runToken } = readCarryforwardManifest(env, now);
  assert.equal(env.EXPECTED_SESSION_NAME, "chronote-sandbox-" + runToken);
  const aws = options.aws ?? awsCli;
  const actor = await aws("sts", "get-caller-identity", {});
  assertSandboxIdentity(actor, env);
  const types =
    options.types ?? require("../../dist/types/deploymentControl.js");
  const inventory = options.writerInventory ?? createWriterInventory({ env });
  await inventory.assertExclusive();
  const configEnv = {
    ...env,
    DEPLOYMENT_RUN_TOKEN: runToken,
    DEPLOYMENT_CANDIDATE_ID: manifest.operationId,
    CANDIDATE_IMAGE: manifest.image,
  };
  const config = configuration(configEnv);
  const base = {
    ...options,
    env: configEnv,
    aws,
    types,
    now,
    taskTemplate: {
      arn: manifest.templateArn,
      preparedSha256: manifest.preparedDefinitionSha256,
    },
  };
  const coordinator = createCoordinator(base);
  const inspector = createCarryforwardInspection({
    ...base,
    coordinator,
    config,
    manifest,
    manifestSha256: hash,
  });
  const observed = await inspector.inspect();
  if (options.mode === "inspect")
    return {
      kind: "inspection",
      binding: observed.binding,
      bindingSha256: observed.bindingSha256,
    };
  assert.equal(env.CARRYFORWARD_BINDING_SHA256, observed.bindingSha256);
  await inventory.assertExclusive();
  const fresh = await inspector.inspect();
  assert.equal(fresh.bindingSha256, observed.bindingSha256);
  await inventory.assertExclusive();
  assert.ok(
    fresh.nativeProtectionExpiresAt > now() + 120,
    "Native protection expired before carryforward commit",
  );
  assert.ok(manifest.approveBefore > now());
  const claim = buildCarryforward({
    manifest,
    manifestSha256: hash,
    bindingSha256: fresh.bindingSha256,
    observed: fresh,
    runToken,
    actorArn: actor.Arn,
    now: now(),
    types,
    builders: options.builders,
  });
  await commitCarryforward({ aws, inspector, claim });
  const mutations = new Set([
    "update-item",
    "transact-write-items",
    "register-task-definition",
    "update-service",
    "modify-listener",
  ]);
  const authority = createCarryforwardAuthority({
    aws,
    inspector,
    config,
    env: configEnv,
    types,
    now,
    manifest,
    runToken,
    claim,
    recovery: fresh.recovery,
  });
  async function guardedAws(service, operation, input) {
    if (mutations.has(operation)) {
      await inventory.assertExclusive();
      await authority.assertBeforeWrite(operation, input);
    }
    return aws(service, operation, input);
  }
  const deployment = createCoordinator({ ...base, aws: guardedAws });
  let refreshed = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const serving = await deployment.inspectServing();
      assert.deepEqual(serving.source, fresh.source);
      assert.equal(
        serving.control.coordinatorEpoch,
        claim.next.coordinatorEpoch,
      );
      refreshed = true;
      break;
    } catch {
      await (options.sleep ?? sleep)(1000);
    }
  }
  assert.ok(
    refreshed,
    "Recovered source did not refresh at carryforward epoch; preserve archive",
  );
  assert.equal((await deployment.prepare()).kind, "warming");
  assert.equal((await deployment.promote()).kind, "promoted");
  assert.equal((await deployment.retire()).kind, "complete");
  const completed = await inspector.control();
  assert.equal(completed.coordinatorToken, runToken);
  assert.equal(completed.deployment.phase, "complete");
  assert.deepEqual(
    await inspector.read(inspector.archiveKey, "ARCHIVE"),
    claim.archive,
  );
  assert.deepEqual(
    await inspector.read(fresh.recovery.pk, "RECOVERY"),
    fresh.recovery,
  );
  return {
    kind: "carryforward_complete",
    settlement: "lost_owner_settlement_pending",
    bindingSha256: fresh.bindingSha256,
  };
}
module.exports = { carryforwardSandbox };
if (require.main === module)
  runRecoveryCli(
    carryforwardSandbox,
    process.argv[2],
    "sandbox_carryforward_failed",
  );
