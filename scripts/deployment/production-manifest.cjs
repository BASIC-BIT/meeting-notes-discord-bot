"use strict";
const assert = require("node:assert/strict");
const { z } = require("zod");
const { manifestHash } = require("./sandbox-manifest.cjs");
const { buildMaintenancePolicy } = require("./maintenance-fence.cjs");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const text = z.string().min(1);
const time = z.number().int().positive();
const slots = [
  "leases",
  "history",
  "controls",
  "uploads",
  "segments",
  "billing",
  "webhooks",
  "payments",
];
const bindingSchema = z
  .object({
    accountId: z.string().regex(/^\d{12}$/),
    region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
    taskRoleArn: text,
    operationId: z.string().uuid(),
    activeMeetingTableArn: text,
    personalMediaUploadJobTableArn: text,
    sourceSha: sha,
    legacySha: sha,
    candidateDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    tableArns: z
      .object(Object.fromEntries(slots.map((k) => [k, text])))
      .strict(),
  })
  .strict();
const schema = z
  .object({
    kind: z.literal("production-introduction"),
    environment: z.literal("production"),
    binding: bindingSchema,
    deploymentRoleArn: text,
    executionRoleArn: text,
    sourceRepository: text,
    imageRepository: text,
    cluster: text,
    service: text,
    containerName: text,
    containerPort: z.number().int().positive().max(65535),
    runtimeMode: z.enum(["all", "api", "bot"]),
    bucket: text,
    tablePrefix: text,
    controlTableArn: text,
    legacyTaskArn: text,
    legacyTaskDefinition: text,
    taskDefinition: text,
    fallbackTaskDefinition: text,
    fallbackSourceSha: sha,
    fallbackDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    targetDeploymentConfiguration: z
      .object({
        minimumHealthyPercent: z.literal(100),
        maximumPercent: z.literal(200),
        strategy: z.literal("ROLLING"),
        earlySuccessCriteria: z
          .object({
            enable: z.literal(true),
            healthyPercent: z.literal(100),
            sourceServiceRevisionCleanup: z.literal("DEFERRED"),
          })
          .strict(),
        deploymentCircuitBreaker: z
          .object({ enable: z.literal(true), rollback: z.literal(false) })
          .strict(),
      })
      .strict(),
    listenerArn: text,
    targetGroupA: text,
    targetGroupB: text,
    ownedPolicyName: text,
    ownedPolicySha256: hash,
    originalPolicySha256: hash,
    originalControllerSha256: hash,
    targetControllerSha256: hash,
    knownWriterSha256: hash,
    collectorCommandSha256: hash,
    originalServiceSha256: hash,
    originalRoutingSha256: hash,
    evidenceStoreId: text,
    validUntil: time,
    observationMaxAgeSeconds: z.number().int().positive().max(300),
    drainDeadline: time,
    warmupDeadline: time,
    maxPages: z.number().int().positive().max(1000),
    maxRows: z.number().int().positive().max(100000),
    pageSize: z.number().int().positive().max(1000),
  })
  .strict();
const phases = [
  "inspect",
  "fence",
  "drain",
  "activate",
  "abort",
  "reconcile",
  "complete",
];
function assertHash(input, expected) {
  hash.parse(expected);
  assert.equal(manifestHash(input), expected, "Checksum mismatch");
}
function assertResources(m) {
  const b = m.binding,
    account = b.accountId,
    region = b.region;
  const ecs = `arn:aws:ecs:${region}:${account}:`,
    elb = `arn:aws:elasticloadbalancing:${region}:${account}:`,
    table = `arn:aws:dynamodb:${region}:${account}:table/`;
  for (const role of [b.taskRoleArn, m.executionRoleArn, m.deploymentRoleArn])
    assert.match(
      role,
      new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]+$`),
    );
  for (const definition of [
    m.legacyTaskDefinition,
    m.taskDefinition,
    m.fallbackTaskDefinition,
  ]) {
    assert.ok(definition.startsWith(ecs + "task-definition/"));
    assert.match(
      definition.slice((ecs + "task-definition/").length),
      /^[A-Za-z0-9_-]+:\d+$/,
    );
  }
  assert.equal(
    new Set([
      m.legacyTaskDefinition,
      m.taskDefinition,
      m.fallbackTaskDefinition,
    ]).size,
    3,
  );
  assert.ok(m.legacyTaskArn.startsWith(ecs + "task/" + m.cluster + "/"));
  assert.match(m.legacyTaskArn.split("/").at(-1), /^[a-f0-9]{32}$/);
  assert.ok(m.listenerArn.startsWith(elb + "listener/app/"));
  for (const group of [m.targetGroupA, m.targetGroupB])
    assert.ok(group.startsWith(elb + "targetgroup/"));
  assert.notEqual(m.targetGroupA, m.targetGroupB);
  const tables = [...Object.values(b.tableArns), m.controlTableArn];
  assert.equal(new Set(tables).size, 9);
  for (const arn of tables) {
    assert.ok(arn.startsWith(table + m.tablePrefix));
    assert.match(arn.slice(table.length), /^[A-Za-z0-9_.-]+$/);
  }
  assert.equal(
    m.controlTableArn,
    table + m.tablePrefix + "DeploymentControlTable",
  );
  assert.equal(b.tableArns.leases, b.activeMeetingTableArn);
  assert.equal(b.tableArns.uploads, b.personalMediaUploadJobTableArn);
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
}
function parseProductionManifest(input, expectedSha256) {
  assertHash(input, expectedSha256);
  const m = schema.parse(input);
  assertResources(m);
  assert.notEqual(
    m.binding.sourceSha,
    m.binding.legacySha,
    "Legacy source is incompatible",
  );
  assert.notEqual(
    m.fallbackSourceSha,
    m.binding.legacySha,
    "Legacy fallback is incompatible",
  );
  assert.equal(
    m.ownedPolicyName,
    "chronote-maintenance-" + m.binding.operationId,
  );
  assert.equal(
    m.ownedPolicySha256,
    manifestHash(buildMaintenancePolicy(m.binding)),
  );
  assert.ok(
    m.drainDeadline < m.warmupDeadline && m.warmupDeadline <= m.validUntil,
  );
  return m;
}
const envelopeSchema = z
  .object({
    kind: z.literal("production-phase"),
    manifestSha256: hash,
    operationId: z.string().uuid(),
    phase: z.enum(phases),
    runId: z.string().regex(/^[1-9]\d{0,19}$/),
    runAttempt: z.literal(1),
    principalArn: text,
    sourceSha: sha,
    predecessorSha256: hash.nullable(),
    validUntil: time,
    recovery: z
      .object({
        submittedReceiptSha256: hash,
        evidenceSha256: hash,
        target: z.enum(["inspect", "fallback"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
function parsePhaseAuthorization(input, manifest, expectedSha256) {
  const m = parseProductionManifest(manifest, expectedSha256);
  assertHash(input.envelope, input.expectedSha256);
  assert.equal(
    input.bindSha256,
    input.expectedSha256,
    "Missing or changed dispatch binding",
  );
  const a = envelopeSchema.parse(input.envelope),
    b = m.binding;
  assert.equal(a.manifestSha256, expectedSha256);
  assert.equal(a.operationId, b.operationId);
  assert.equal(a.sourceSha, b.sourceSha);
  assert.equal(a.runId, input.currentRunId);
  assert.equal(a.runAttempt, input.currentRunAttempt);
  const roleName = m.deploymentRoleArn.split("/").at(-1);
  assert.equal(
    a.principalArn,
    `arn:aws:sts::${b.accountId}:assumed-role/${roleName}/chronote-production-${a.runId}-1`,
  );
  assert.ok(a.validUntil <= m.validUntil);
  if (a.recovery) {
    assert.ok(["activate", "reconcile"].includes(a.phase));
    assert.equal(
      a.recovery.target,
      a.phase === "activate" ? "fallback" : "inspect",
    );
  }
  return a;
}
module.exports = { parseProductionManifest, parsePhaseAuthorization, phases };
