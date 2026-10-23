/** @jest-environment node */
import { test, expect } from "@jest/globals";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import process from "node:process";
import {
  pluginStream,
  sessionArguments,
  collectTaskSession,
} from "../../scripts/deployment/collector-session.cjs";
import { collectRehearsalTags } from "../../scripts/deployment/collector-tags.cjs";
import {
  collectionBlockers,
  createTrustedCollector,
} from "../../scripts/deployment/trusted-collector.cjs";
import { renderCollector } from "../../scripts/deployment/collector-command.cjs";
import { manifestFixture } from "../fixtures/deployment/productionIntroduction.js";
import { manifestHash } from "../../scripts/deployment/sandbox-manifest.cjs";
test("session secret response exists only in the child environment and is never an argument", async () => {
  const m = manifestFixture(),
    session = {
      sessionId: "ecs-session",
      tokenValue: "synthetic-private-token",
      streamUrl:
        "wss://ssmmessages.us-east-1.amazonaws.com/v1/data-channel/ecs-session?role=publish_subscribe",
    };
  const args = sessionArguments(
    m,
    { taskArn: m.legacyTaskArn, runtimeId: "a".repeat(32) },
    session,
  );
  let captured;
  const launch = (command, argv, options) => {
    captured = { command, argv, options };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("bounded"));
      child.emit("close", 0);
    });
    return child;
  };
  const before = process.env.AWS_SSM_START_SESSION_RESPONSE_CHRONOTE;
  expect((await pluginStream(args, session, launch)).toString()).toBe(
    "bounded",
  );
  expect(captured.argv.join(" ")).not.toContain(session.tokenValue);
  expect(captured.argv.join(" ")).not.toContain(session.streamUrl);
  expect(
    JSON.parse(captured.options.env.AWS_SSM_START_SESSION_RESPONSE_CHRONOTE),
  ).toEqual(session);
  expect(process.env.AWS_SSM_START_SESSION_RESPONSE_CHRONOTE).toBe(before);
});
test("Windows transport is refused before any version or Exec operation", async () => {
  let calls = 0;
  await expect(
    collectTaskSession({
      platform: "win32",
      version: async () => {
        calls++;
      },
      ecs: {
        send: async () => {
          calls++;
        },
      },
    }),
  ).rejects.toThrow(/Windows/);
  expect(calls).toBe(0);
});
test("native tags, not rehearsal declarations, establish exact resource ownership", async () => {
  const tags = {
    Environment: "rehearsal",
    OperationId: "op",
    DisposablePrefix: "cr-prefix-",
  };
  const m = {
    kind: "rehearsal-introduction",
    resourceEvidence: [
      {
        arn: "arn:aws:ecs:us-east-1:123456789012:cluster/cr-prefix-cluster",
        tags,
      },
    ],
  };
  expect(
    await collectRehearsalTags(
      async () => ({
        tags: Object.entries(tags).map(([key, value]) => ({ key, value })),
      }),
      m,
    ),
  ).toHaveLength(1);
  await expect(
    collectRehearsalTags(
      async () => ({ tags: [{ key: "Environment", value: "production" }] }),
      m,
    ),
  ).rejects.toThrow(/ownership/);
  await expect(
    collectRehearsalTags(async () => {
      throw new Error("secret");
    }, m),
  ).rejects.toThrow(/prerequisite/);
});
test("empty inventories still require externally authenticated writer freeze and cached credential proof", () => {
  const empty = {
    tables: {
      leases: [],
      history: [],
      controls: [],
      uploads: [],
      segments: [],
      billing: [],
      webhooks: [],
      payments: [],
    },
  };
  const blockers = collectionBlockers(empty);
  expect(blockers).toContain("cached_application_credentials_unproved");
  expect(blockers).toContain(
    "recovery_publication_apply_process_and_nonexpiring_claims_unproved",
  );
  expect(blockers).toContain(
    "recovery_publication_reconcile_process_and_nonexpiring_intents_unproved",
  );
  expect(blockers.some((b) => b.startsWith("row_bound_"))).toBe(false);
  const occupied = collectionBlockers({
    tables: {
      ...empty.tables,
      billing: [{ status: "paid" }],
      uploads: [{ status: "completed" }],
    },
  });
  expect(occupied).toContain("row_bound_billing_settlement_unproved");
  expect(occupied).toContain(
    "immutable_objects_tokens_schema_compatibility_unproved",
  );
});
test("the trusted factory cannot be activated without a complete private binding", () => {
  const m = manifestFixture();
  expect(() =>
    createTrustedCollector({ manifest: m, expectedSha256: manifestHash(m) }),
  ).toThrow();
});

test("ambiguous Exec submission is made once and never opens an unrelated plugin stream", async () => {
  const m = manifestFixture(),
    request = renderCollector(m, {
      nonce: "nonce",
      taskArn: m.legacyTaskArn,
    }).request;
  let submissions = 0,
    plugins = 0;
  const options = {
    m,
    request,
    native: { taskArn: m.legacyTaskArn },
    platform: "linux",
    version: async () => ({ stdout: "1.2.835.0\n" }),
    launch: () => {
      plugins++;
    },
    ecs: {
      config: { maxAttempts: async () => 1 },
      send: async () => {
        submissions++;
        throw new Error("private provider text");
      },
    },
  };
  await expect(collectTaskSession(options)).rejects.toThrow(
    "UNKNOWN: Exec/session acknowledgment; do not retry",
  );
  expect(submissions).toBe(1);
  expect(plugins).toBe(0);
});
test("foreign native Exec response cannot be attached to the requested task", async () => {
  const m = manifestFixture(),
    request = renderCollector(m, {
      nonce: "nonce",
      taskArn: m.legacyTaskArn,
    }).request;
  let plugins = 0;
  await expect(
    collectTaskSession({
      m,
      request,
      native: { taskArn: m.legacyTaskArn },
      platform: "linux",
      version: async () => ({ stdout: "1.2.835.0" }),
      launch: () => {
        plugins++;
      },
      ecs: {
        config: { maxAttempts: async () => 1 },
        send: async () => ({ taskArn: "foreign" }),
      },
    }),
  ).rejects.toThrow(/UNKNOWN/);
  expect(plugins).toBe(0);
});
