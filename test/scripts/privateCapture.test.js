/** @jest-environment node */
import { Buffer } from "node:buffer";
import { test, expect } from "@jest/globals";
import { createPrivateCapture } from "../../scripts/deployment/private-capture.cjs";
import { manifestFixture } from "../fixtures/deployment/productionIntroduction.js";
import { digest } from "../../scripts/deployment/collector-payload.cjs";
import { manifestHash } from "../../scripts/deployment/sandbox-manifest.cjs";
function fixture() {
  const m = manifestFixture(),
    calls = [],
    objects = new Map();
  const binding = {
    kind: "versioned-private-s3-v1",
    storeId: m.evidenceStoreId,
    bucket: "private-synthetic",
    accountId: m.binding.accountId,
    region: m.binding.region,
    kmsKeyArn:
      "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111",
    policySha256: digest("{}"),
    lifecycleSha256: digest("null"),
    retentionUntil: 6000,
    administratorTrustSha256: "a".repeat(64),
  };
  const client = {
    config: { maxAttempts: async () => 1, region: async () => binding.region },
    send: async (command) => {
      calls.push(command);
      const key = command.constructor.name,
        i = command.input;
      const native = {
        GetBucketLocationCommand: { LocationConstraint: null },
        GetBucketVersioningCommand: { Status: "Enabled" },
        GetBucketOwnershipControlsCommand: {
          OwnershipControls: {
            Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
          },
        },
        GetPublicAccessBlockCommand: {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        },
        GetBucketPolicyStatusCommand: { PolicyStatus: { IsPublic: false } },
        GetBucketPolicyCommand: { Policy: "{}" },
        GetBucketEncryptionCommand: {
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: "aws:kms",
                  KMSMasterKeyID: binding.kmsKeyArn,
                },
                BucketKeyEnabled: false,
              },
            ],
          },
        },
      };
      if (key === "GetBucketLifecycleConfigurationCommand")
        throw Object.assign(new Error("absent"), {
          name: "NoSuchLifecycleConfiguration",
        });
      if (key === "PutObjectCommand") {
        objects.set(i.Key, Buffer.from(i.Body));
        return { VersionId: "v1" };
      }
      if (key === "GetObjectCommand")
        return {
          VersionId: "v1",
          ContentLength: objects.get(i.Key).length,
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: binding.kmsKeyArn,
          BucketKeyEnabled: false,
          Body: [objects.get(i.Key)],
        };
      if (!native[key]) throw new Error(key);
      return native[key];
    },
  };
  return {
    m,
    binding,
    client,
    calls,
    objects,
    options: {
      m,
      manifestSha256: manifestHash(m),
      binding,
      client,
      now: () => 1000,
    },
  };
}
test("private capture uses conditional one-attempt creation and exact version original-byte readback", async () => {
  const f = fixture(),
    store = createPrivateCapture(f.options),
    value = { z: "private", a: 1 };
  const ref = await store.capture(value);
  expect(ref.versionId).toBe("v1");
  expect(await store.readCapture(ref)).toEqual(value);
  const writes = f.calls.filter(
    (c) => c.constructor.name === "PutObjectCommand",
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].input.IfNoneMatch).toBe("*");
  expect(writes[0].input.Body.toString()).toBe('{"z":"private","a":1}');
  expect(
    f.calls
      .filter((c) => c.constructor.name === "GetObjectCommand")
      .every((c) => c.input.VersionId === "v1"),
  ).toBe(true);
  expect(
    f.calls.every((c) => c.input.ExpectedBucketOwner === f.binding.accountId),
  ).toBe(true);
});
test("missing configuration refuses before any transport", () => {
  const f = fixture();
  expect(() =>
    createPrivateCapture({ ...f.options, binding: undefined }),
  ).toThrow();
  expect(f.calls).toHaveLength(0);
});
test.each([
  "unknown-write",
  "null-version",
  "changed-bytes",
  "changed-version",
  "public",
  "lifecycle",
  "retention",
])("rejects %s without retry or delete", async (fault) => {
  const f = fixture(),
    send = f.client.send;
  if (fault === "retention") f.binding.retentionUntil = 999;
  f.client.send = async (c) => {
    if (
      c.constructor.name === "PutObjectCommand" &&
      fault === "unknown-write"
    ) {
      await send(c);
      throw new Error("synthetic secret must not escape");
    }
    const result = await send(c);
    if (c.constructor.name === "PutObjectCommand" && fault === "null-version")
      result.VersionId = "null";
    if (c.constructor.name === "GetObjectCommand" && fault === "changed-bytes")
      result.Body = [Buffer.from("{}")];
    if (
      c.constructor.name === "GetObjectCommand" &&
      fault === "changed-version"
    )
      result.VersionId = "v2";
    if (
      c.constructor.name === "GetBucketPolicyStatusCommand" &&
      fault === "public"
    )
      result.PolicyStatus.IsPublic = true;
    return result;
  };
  if (fault === "lifecycle")
    f.client.send = async (c) =>
      c.constructor.name === "GetBucketLifecycleConfigurationCommand"
        ? { Rules: [{ Status: "Enabled", Expiration: { Days: 1 } }] }
        : send(c);
  await expect(async () => {
    const store = createPrivateCapture(f.options);
    await store.capture({ a: 1 });
  }).rejects.toThrow(/UNKNOWN|retention|privacy|lifecycle|version|bytes/);
  expect(
    f.calls.filter((c) => c.constructor.name === "PutObjectCommand").length,
  ).toBeLessThanOrEqual(1);
  expect(f.calls.some((c) => /Delete/.test(c.constructor.name))).toBe(false);
});
