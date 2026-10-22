"use strict";
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  schema,
  envelopeSchema,
  assertHash,
  validateManifest,
  validateAuthorization,
  phases,
} = require("./introduction-validation.cjs");
const productionSchema = schema
  .extend({
    kind: z.literal("production-introduction"),
    environment: z.literal("production"),
  })
  .strict();
const authorizationSchema = envelopeSchema
  .extend({ kind: z.literal("production-phase") })
  .strict();
function parseProductionManifest(input, expectedSha256) {
  assertHash(input, expectedSha256);
  const m = validateManifest(productionSchema.parse(input));
  const tables = [...Object.values(m.binding.tableArns), m.controlTableArn];
  for (const value of [
    m.cluster,
    m.service,
    m.bucket,
    m.tablePrefix,
    m.containerName,
    m.imageRepository,
    ...tables,
    m.taskDefinition,
    m.legacyTaskDefinition,
    m.fallbackTaskDefinition,
    m.deploymentRoleArn,
    m.executionRoleArn,
    m.binding.taskRoleArn,
    m.listenerArn,
    m.targetGroupA,
    m.targetGroupB,
  ])
    assert.ok(!/sandbox|rehearsal/i.test(value), "Nonproduction resource");
  return m;
}
function parsePhaseAuthorization(input, manifest, expectedSha256) {
  const m = parseProductionManifest(manifest, expectedSha256);
  const a = validateAuthorization(
    input,
    authorizationSchema.parse(input.envelope),
    m,
    expectedSha256,
  );
  const roleName = m.deploymentRoleArn.split("/").at(-1);
  assert.equal(
    a.principalArn,
    `arn:aws:sts::${m.binding.accountId}:assumed-role/${roleName}/chronote-production-${a.runId}-1`,
  );
  return a;
}
module.exports = { parseProductionManifest, parsePhaseAuthorization, phases };
