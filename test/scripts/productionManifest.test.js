/** @jest-environment node */
import { expect, test } from "@jest/globals";
import {
  manifestFixture,
  phaseAuthorization,
} from "../fixtures/deployment/productionIntroduction.js";
import {
  manifestHash,
  parseManifest,
} from "../../scripts/deployment/sandbox-manifest.cjs";
import {
  parseProductionManifest,
  parsePhaseAuthorization,
} from "../../scripts/deployment/production-manifest.cjs";

const authorization = (m) => phaseAuthorization(m, "fence");
test("strict production manifest accepts exact operation and Sandbox rejects it", () => {
  const m = manifestFixture();
  expect(parseProductionManifest(m, manifestHash(m))).toEqual(m);
  expect(() => parseManifest(m, manifestHash(m))).toThrow();
});
test.each([
  "environment",
  "kind",
  "ownedPolicySha256",
  "taskDefinition",
  "controlTableArn",
])("rejects changed %s", (field) => {
  const m = manifestFixture();
  m[field] = "invalid";
  expect(() => parseProductionManifest(m, manifestHash(m))).toThrow();
});
test("requires reviewed manifest hash", () => {
  const m = manifestFixture();
  expect(() => parseProductionManifest(m, "0".repeat(64))).toThrow();
});
test("accepts exact invocation envelope", () => {
  const m = manifestFixture(),
    a = authorization(m);
  expect(parsePhaseAuthorization(a, m, manifestHash(m))).toEqual(a.envelope);
});
test.each([
  "bindSha256",
  "expectedSha256",
  "currentRunId",
  "currentRunAttempt",
])("rejects delivery substitution %s", (field) => {
  const m = manifestFixture(),
    a = authorization(m);
  a[field] = "wrong";
  expect(() => parsePhaseAuthorization(a, m, manifestHash(m))).toThrow();
});
test.each([
  "operationId",
  "manifestSha256",
  "principalArn",
  "sourceSha",
  "phase",
  "runAttempt",
])("rejects invalid envelope %s even when rehashed", (field) => {
  const m = manifestFixture(),
    a = authorization(m);
  a.envelope[field] = "wrong";
  a.expectedSha256 = a.bindSha256 = manifestHash(a.envelope);
  expect(() => parsePhaseAuthorization(a, m, manifestHash(m))).toThrow();
});

test.each([
  "fallbackTaskDefinition",
  "fallbackSourceSha",
  "fallbackDigest",
  "targetDeploymentConfiguration",
])("requires explicit approved fallback/controller %s", (field) => {
  const m = manifestFixture();
  delete m[field];
  expect(() => parseProductionManifest(m, manifestHash(m))).toThrow();
});
test("refuses automatic rollback in the approved target configuration", () => {
  const m = manifestFixture();
  m.targetDeploymentConfiguration.deploymentCircuitBreaker.rollback = true;
  expect(() => parseProductionManifest(m, manifestHash(m))).toThrow();
});

test("accepts explicitly bound candidate-equal fallback definition source and digest", () => {
  const m = manifestFixture();
  m.fallbackTaskDefinition = m.taskDefinition;
  m.fallbackSourceSha = m.binding.sourceSha;
  m.fallbackDigest = m.binding.candidateDigest;
  expect(parseProductionManifest(m, manifestHash(m))).toEqual(m);
});

test.each(["taskDefinition", "fallbackTaskDefinition"])(
  "rejects legacy as %s",
  (field) => {
    const m = manifestFixture();
    m[field] = m.legacyTaskDefinition;
    expect(() => parseProductionManifest(m, manifestHash(m))).toThrow();
  },
);
