import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSandboxHandoffPlan,
  planGeneratedDescendantRemoval,
  runCli,
} from "../../scripts/deployment/verify-sandbox-handoff.cjs";
function fixture() {
  const runId = randomUUID();
  const artifact = {
    sourceCommit: "a".repeat(40),
    imageDigest: `sha256:${"b".repeat(64)}`,
    taskDefinition: "generated:1",
  };
  return {
    environment: "sandbox",
    accountId: "123456789012",
    region: "us-east-1",
    cluster: "generated-sandbox",
    service: "generated-sandbox",
    tablePrefix: "generated-sandbox-",
    bucket: "generated-sandbox",
    fixture: {
      runId,
      guildId: "generated-guild",
      voiceChannelId: "generated-voice",
      textChannelId: "generated-text",
      ownerUserId: "generated-owner",
      prefix: `generated/handoff/${runId}/`,
      checksums: ["c".repeat(64)],
    },
    old: artifact,
    candidate: artifact,
    rollback: artifact,
  };
}
test("explicit Sandbox dry-run reports only unexecuted stages and content checksums", () => {
  const plan = buildSandboxHandoffPlan(fixture());
  expect(plan).toMatchObject({
    providerMutations: 0,
    providerAcceptance: "UNKNOWN",
    identityVerification: "UNKNOWN",
    cleanupRoute: "MISSING",
    fixtureChecksums: ["c".repeat(64)],
  });
  expect(plan.stages).toHaveLength(10);
  expect(
    plan.stages.every(
      (stage: { outcome: string }) => stage.outcome === "NOT_RUN",
    ),
  ).toBe(true);
});
test.each([
  {},
  { environment: "production" },
  { bucket: "production" },
  { candidate: undefined },
])("refuses missing or non-Sandbox scope %j", (patch) => {
  expect(() =>
    buildSandboxHandoffPlan(
      Object.keys(patch).length ? { ...fixture(), ...patch } : {},
    ),
  ).toThrow();
});
test("refuses execution and a fixture-prefix mismatch", () => {
  expect(() => runCli(["--execute"])).toThrow();
  const input = fixture();
  input.fixture.prefix = `generated/handoff/${randomUUID()}/`;
  expect(() => buildSandboxHandoffPlan(input)).toThrow();
});
function cleanupFixture() {
  const prefix = fixture().fixture.prefix;
  const owner = {
    meetingId: "generated-meeting",
    ownerInstanceId: "generated-runtime",
    executionVersion: 1,
  };
  const settled = {
    owner,
    outcome: "verified_settled",
    receipt: "generated-ack",
  };
  const keys = [
    `${prefix}checkpoints/v1/1-owner/manifest.json`,
    `${prefix}checkpoints/v1/1-owner/completed.pcm`,
    `${prefix}checkpoints/v1/1-owner/orphan.pcm`,
    `${prefix}notes.txt`,
  ];
  return {
    scope: "generated-local",
    prefix,
    history: { owner, status: "complete", receipt: "generated-history-ack" },
    capture: settled,
    recovery: settled,
    currentWork: settled,
    enumeration: { complete: true, keys, receipt: "generated-complete-list" },
  };
}
test.each(["capture", "recovery", "currentWork"] as const)(
  "refuses active, uncertain or absent %s proof and preserves every generated object",
  (domain) => {
    const input = cleanupFixture();
    const objects = new Map(
      input.enumeration.keys.map((key) => [key, Buffer.from("generated")]),
    );
    for (const outcome of [
      "active",
      "uncertain",
      "unknown",
      "absent",
      "expired",
    ])
      expect(() =>
        planGeneratedDescendantRemoval({
          ...input,
          [domain]: { ...input[domain], outcome },
        }),
      ).toThrow();
    expect(objects.size).toBe(4);
  },
);
test("generated completed and orphan descendants are covered only after independent settlement receipts", () => {
  const input = cleanupFixture();
  const unrelated = "generated/other/keep.pcm";
  const objects = new Map(
    [...input.enumeration.keys, unrelated].map((key) => [
      key,
      Buffer.from("generated"),
    ]),
  );
  const plan = planGeneratedDescendantRemoval(input);
  expect(plan).toMatchObject({
    liveDeletionAuthorized: false,
    liveOwnershipFence: false,
  });
  expect(plan.keys).toEqual(input.enumeration.keys);
  for (const key of plan.keys) objects.delete(key);
  expect([...objects.keys()]).toEqual([unrelated]);
});
test("refuses incomplete enumeration, foreign keys, wrong history attempt and nonterminal history", () => {
  const input = cleanupFixture();
  expect(() =>
    planGeneratedDescendantRemoval({
      ...input,
      enumeration: { ...input.enumeration, complete: false },
    }),
  ).toThrow();
  for (const key of [
    "other/file",
    `${input.prefix}../escape`,
    `${input.prefix}folder\\escape`,
  ])
    expect(() =>
      planGeneratedDescendantRemoval({
        ...input,
        enumeration: { ...input.enumeration, keys: [key] },
      }),
    ).toThrow();
  expect(() =>
    planGeneratedDescendantRemoval({
      ...input,
      capture: {
        ...input.capture,
        owner: { ...input.capture.owner, executionVersion: 2 },
      },
    }),
  ).toThrow();
  expect(() =>
    planGeneratedDescendantRemoval({
      ...input,
      history: { ...input.history, status: "processing" },
    }),
  ).toThrow();
});

test("CLI reads only the explicit generated config and returns an unexecuted plan", () => {
  const path = join(tmpdir(), `chronote-h7-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(fixture()), { flag: "wx" });
  try {
    expect(runCli(["--dry-run", "--config", path])).toMatchObject({
      mode: "dry-run",
      providerMutations: 0,
      providerAcceptance: "UNKNOWN",
    });
  } finally {
    unlinkSync(path);
  }
});
