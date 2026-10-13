import { createHash, randomUUID } from "node:crypto";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createDynamoDeploymentControlRepository } from "../../src/repositories/deploymentControlRepository";
import {
  type CheckpointFlushInput,
  createRecordingCheckpointService,
} from "../../src/services/recordingCheckpointService";
import { history, control, runtime, promotion } from "./controlFixtures";

const prefix = `checkpoint-test-${randomUUID()}-`;
const tables = {
  deploymentControl: `${prefix}Control`,
  meetingHistory: `${prefix}History`,
  activeMeeting: `${prefix}Lease`,
};
const client = new DynamoDBClient({
  endpoint: process.env.DEPLOYMENT_TEST_DYNAMODB_ENDPOINT,
  region: "local",
  credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
});
const repository = createDynamoDeploymentControlRepository(client, tables);
const objects = new Map<string, Buffer>();
const service = createRecordingCheckpointService({
  repository,
  objects: {
    upload: async (key, body) => {
      if (!objects.has(key)) objects.set(key, Buffer.from(body));
      return key;
    },
    read: async (key) => objects.get(key),
  },
});
const capture = {
  guildId: history.guildId,
  channelId: history.channelId,
  channelId_timestamp: history.channelId_timestamp,
  meetingId: history.meetingId,
  ownerInstanceId: "old",
  executionVersion: 1,
  reservedAt: history.timestamp,
  requested: { transcribeMeeting: true, generateNotes: true },
  captureStartedAt: null,
};
const input = {
  capture,
  expectedStatus: "starting" as const,
  previous: undefined,
  artifacts: [],
};
const created: string[] = [];
beforeAll(async () => {
  await client.send(
    new CreateTableCommand({
      TableName: tables.meetingHistory,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "guildId", KeyType: "HASH" },
        { AttributeName: "channelId_timestamp", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "guildId", AttributeType: "S" },
        { AttributeName: "channelId_timestamp", AttributeType: "S" },
      ],
    }),
  );
  created.push(tables.meetingHistory);
  for (const [TableName, keys] of [
    [tables.activeMeeting, ["guildId"]],
    [tables.deploymentControl, ["pk", "sk"]],
  ] as const) {
    await client.send(
      new CreateTableCommand({
        TableName,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: keys.map((AttributeName, index) => ({
          AttributeName,
          KeyType: index === 0 ? "HASH" : "RANGE",
        })),
        AttributeDefinitions: keys.map((AttributeName) => ({
          AttributeName,
          AttributeType: "S",
        })),
      }),
    );
    created.push(TableName);
  }
});
afterAll(async () => {
  for (const TableName of created)
    await client.send(new DeleteTableCommand({ TableName }));
  client.destroy();
});
beforeEach(async () => {
  objects.clear();
  await client.send(
    new PutItemCommand({
      TableName: tables.meetingHistory,
      Item: marshall(history),
    }),
  );
});
test("real repository CAS allows one initial manifest and refuses a stale revision", async () => {
  const results = await Promise.all([
    service.flush(input),
    service.flush(input),
  ]);
  expect(results.filter((r) => r.kind === "committed")).toHaveLength(1);
  expect(results.filter((r) => r.kind === "stale_owner")).toHaveLength(1);
  expect(
    (
      await repository.getMeetingHistory({
        guildId: history.guildId,
        channelId_timestamp: history.channelId_timestamp,
      })
    )?.executionVersion,
  ).toBe(1);
});
test("interruptedPendingRecoveryIsDiscoverable", async () => {
  const result = await service.flush(input);
  if (result.kind !== "committed") throw new Error("fixture commit failed");
  expect(
    await repository.transitionMeetingHistory({
      key: {
        guildId: history.guildId,
        channelId_timestamp: history.channelId_timestamp,
      },
      expectedMeetingId: history.meetingId,
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus: "starting",
      patch: {
        status: "interrupted",
        recovery: {
          disposition: "pending",
          attempt: 0,
          executionVersion: 1,
          stage: "verification",
          retry: { maxAttempts: 3, nextAttemptAt: null },
        },
      },
    }),
  ).toBe("applied");
  const pending = await repository.listPendingRecordingRecoveries(
    history.guildId,
  );
  expect(pending).toHaveLength(1);
  expect(pending[0].recovery?.disposition).toBe("pending");
  expect(
    (await service.read(result.checkpoint)).manifest.capture.captureStartedAt,
  ).toBeNull();
  expect(
    (await service.flush({ ...input, previous: result.checkpoint })).kind,
  ).toBe("stale_owner");
});
test("original checkpoint can be read under a new recovery owner but old owner cannot publish", async () => {
  const first = await service.flush(input);
  if (first.kind !== "committed") throw new Error("fixture commit failed");
  const row = await repository.getMeetingHistory({
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  });
  await client.send(
    new PutItemCommand({
      TableName: tables.meetingHistory,
      Item: marshall({
        ...row,
        executionVersion: 2,
        ownerInstanceId: "recovery",
        status: "processing",
      }),
    }),
  );
  expect(
    (await service.read(first.checkpoint)).manifest.capture.executionVersion,
  ).toBe(1);
  expect(
    (
      await service.flush({
        ...input,
        expectedStatus: "processing",
        previous: first.checkpoint,
      })
    ).kind,
  ).toBe("stale_owner");
});

test("failed processing preserves complete capture and legacy rows are not classified", async () => {
  const result = await service.flush(input);
  if (result.kind !== "committed") throw new Error("fixture commit failed");
  const key = {
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  };
  const captureState = {
    kind: "complete" as const,
    startedAt: "2026-01-01T00:00:02Z",
    endedAt: "2026-01-01T00:01:02Z",
  };
  expect(
    await repository.transitionMeetingHistory({
      key,
      expectedMeetingId: history.meetingId,
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus: "starting",
      patch: {
        status: "failed",
        capture: captureState,
        recovery: {
          disposition: "pending",
          attempt: 0,
          executionVersion: 1,
          stage: "verification",
          retry: { maxAttempts: 3, nextAttemptAt: null },
        },
      },
    }),
  ).toBe("applied");
  const legacy = {
    ...history,
    channelId_timestamp: "legacy",
    ownerInstanceId: undefined,
    executionVersion: undefined,
    status: "in_progress",
  };
  await client.send(
    new PutItemCommand({
      TableName: tables.meetingHistory,
      Item: marshall(legacy, { removeUndefinedValues: true }),
    }),
  );
  const rows = await repository.listPendingRecordingRecoveries(history.guildId);
  expect(rows).toHaveLength(1);
  expect(rows[0].capture).toEqual(captureState);
  expect(rows[0].checkpoint).toEqual(result.checkpoint);
  expect(
    await repository.getMeetingHistory({
      ...key,
      channelId_timestamp: "legacy",
    }),
  ).toEqual({
    ...legacy,
    ownerInstanceId: undefined,
    executionVersion: undefined,
  });
});

const ownership = {
  guildId: history.guildId,
  meetingId: history.meetingId,
  ownerInstanceId: "old",
  executionVersion: 1,
  voiceOperationAttemptId: "voice",
  sessionMode: "meeting" as const,
};
const recovery = {
  disposition: "pending" as const,
  attempt: 0,
  executionVersion: 1,
  stage: "verification" as const,
  retry: { maxAttempts: 3, nextAttemptAt: null },
};
async function failedFixture(initial: CheckpointFlushInput = input) {
  const first = await service.flush(initial);
  if (first.kind !== "committed") throw new Error("fixture commit failed");
  await repository.transitionMeetingHistory({
    key: {
      guildId: history.guildId,
      channelId_timestamp: history.channelId_timestamp,
    },
    expectedMeetingId: history.meetingId,
    expectedOwnerInstanceId: "old",
    expectedExecutionVersion: 1,
    expectedStatus: "starting",
    patch: { status: "failed" },
  });
  await client.send(
    new PutItemCommand({
      TableName: tables.activeMeeting,
      Item: marshall({
        ...ownership,
        leaseExpiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    }),
  );
  return {
    ...initial,
    artifacts: [
      {
        kind: "context" as const,
        sourceId: "context",
        sequence: 0,
        contentType: "application/json",
        coverage: { kind: "unknown" as const },
        bytes: Buffer.from("{}"),
        checksumSha256: createHash("sha256").update("{}").digest("hex"),
      },
    ],
    previous: first.checkpoint,
    expectedStatus: "failed" as const,
    captureState: { kind: "unknown" as const },
    recovery,
    preservation: {
      ownership,
      deadlineEpochMs: Date.now() + 20000,
      signal: new AbortController().signal,
      assertOwnership: async () => {},
    },
  };
}
test("terminal preservation succeeds for the same protected old lease after membership promotion", async () => {
  const terminal = await failedFixture();
  for (const record of [control, runtime("old"), runtime("new", "candidate")])
    await client.send(
      new PutItemCommand({
        TableName: tables.deploymentControl,
        Item: marshall(record),
      }),
    );
  expect(await repository.promote(promotion)).toBe("applied");
  const preserved = await service.preserveTerminalRecordingCheckpoint(terminal);
  expect(preserved.kind).toBe("committed");
  const row = await repository.getMeetingHistory({
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  });
  expect(row?.status).toBe("failed");
  expect(row?.executionVersion).toBe(1);
  expect(
    (await repository.listPendingRecordingRecoveries(history.guildId))[0]
      .recovery,
  ).toEqual(recovery);
});
test("terminal preservation atomically rejects a replacement lease after local callback authorization", async () => {
  const terminal = await failedFixture();
  let entered!: () => void;
  let release!: () => void;
  const atPublication = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let assertions = 0;
  terminal.preservation.assertOwnership = async () => {
    if (++assertions === 2) {
      entered();
      await hold;
    }
  };
  const pending = service.preserveTerminalRecordingCheckpoint(terminal);
  await atPublication;
  await client.send(
    new PutItemCommand({
      TableName: tables.activeMeeting,
      Item: marshall({
        ...ownership,
        ownerInstanceId: "replacement",
        leaseExpiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    }),
  );
  release();
  expect((await pending).kind).toBe("stale_owner");
  const row = await repository.getMeetingHistory({
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  });
  expect(row?.checkpoint).toEqual(terminal.previous);
  expect(row?.recovery).toBeUndefined();
});
test.each([
  "missing",
  "expired",
  "wrong_mode",
  "wrong_attempt",
  "wrong_version",
])("terminal preservation refuses %s lease", async (kind) => {
  const terminal = await failedFixture();
  if (kind === "missing")
    await client.send(
      new DeleteItemCommand({
        TableName: tables.activeMeeting,
        Key: marshall({ guildId: history.guildId }),
      }),
    );
  else
    await client.send(
      new PutItemCommand({
        TableName: tables.activeMeeting,
        Item: marshall({
          ...ownership,
          leaseExpiresAt:
            Math.floor(Date.now() / 1000) + (kind === "expired" ? -1 : 60),
          ...(kind === "wrong_mode" ? { sessionMode: "tts_only" } : {}),
          ...(kind === "wrong_attempt"
            ? { voiceOperationAttemptId: "later" }
            : {}),
          ...(kind === "wrong_version" ? { executionVersion: 2 } : {}),
        }),
      }),
    );
  expect(
    (await service.preserveTerminalRecordingCheckpoint(terminal)).kind,
  ).toBe("stale_owner");
});
test("terminal abort/deadline cannot publish recovery metadata", async () => {
  const terminal = await failedFixture();
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await service.preserveTerminalRecordingCheckpoint({
        ...terminal,
        preservation: { ...terminal.preservation, signal: controller.signal },
      })
    ).kind,
  ).toBe("preservation_failed");
  expect(
    (
      await service.preserveTerminalRecordingCheckpoint({
        ...terminal,
        preservation: {
          ...terminal.preservation,
          deadlineEpochMs: Date.now() - 1,
        },
      })
    ).kind,
  ).toBe("preservation_failed");
  expect(
    await repository.listPendingRecordingRecoveries(history.guildId),
  ).toHaveLength(0);
});
test("terminal transition only permits checkpoint/capture/recovery metadata", async () => {
  const terminal = await failedFixture();
  await expect(
    repository.transitionMeetingHistory({
      key: {
        guildId: history.guildId,
        channelId_timestamp: history.channelId_timestamp,
      },
      expectedMeetingId: history.meetingId,
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus: "failed",
      expectedCheckpointRevision: terminal.previous.revision,
      signal: terminal.preservation.signal,
      terminalPreservation: {
        kind: "terminal_preservation",
        ownership,
        now: Math.floor(Date.now() / 1000),
      },
      patch: { notes: "generated forbidden change" },
    }),
  ).rejects.toThrow();
});

test("terminal failure cannot relabel complete capture recorded only in the manifest", async () => {
  const complete = {
    kind: "complete" as const,
    startedAt: "2026-01-01T00:00:02.000Z",
    endedAt: "2026-01-01T00:00:03.000Z",
  };
  const terminal = await failedFixture({
    ...input,
    capture: { ...capture, captureStartedAt: complete.startedAt },
    captureState: complete,
  });
  const key = {
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  };
  expect((await repository.getMeetingHistory(key))?.capture).toBeUndefined();
  expect(
    (
      await service.preserveTerminalRecordingCheckpoint({
        ...terminal,
        captureState: {
          kind: "interrupted",
          startedAt: complete.startedAt,
          endedAt: null,
          detectedAt: "2026-01-01T00:00:04.000Z",
        },
      })
    ).kind,
  ).toBe("preservation_failed");
  const rejected = await repository.getMeetingHistory(key);
  expect(rejected?.checkpoint).toEqual(terminal.previous);
  expect(rejected?.recovery).toBeUndefined();
  expect(rejected?.status).toBe("failed");
  const preserved = await service.preserveTerminalRecordingCheckpoint({
    ...terminal,
    captureState: complete,
  });
  expect(preserved.kind).toBe("committed");
  if (preserved.kind !== "committed")
    throw new Error("fixture preservation failed");
  const row = await repository.getMeetingHistory(key);
  expect(row?.capture).toEqual(complete);
  expect(row?.recovery).toEqual(recovery);
  expect(row?.status).toBe("failed");
  expect(
    (await service.read(preserved.checkpoint)).manifest.captureState,
  ).toEqual(complete);
  expect(preserved.checkpoint.capture).toEqual(terminal.previous.capture);
});

test.each([
  [1, "abort"],
  [2, "abort"],
  [1, "deadline"],
  [2, "deadline"],
] as const)(
  "terminal %s history read settles on SDK %s cancellation",
  async (heldRead, cancellation) => {
    const terminal = await failedFixture();
    const controller = new AbortController();
    const handler = new NodeHttpHandler();
    const handle = handler.handle.bind(handler);
    let entered!: () => void;
    const atRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let readCount = 0;
    let readSettled = false;
    let aborted = false;
    let watchdogFired = false;
    const signals: unknown[] = [];
    jest
      .spyOn(handler, "handle")
      .mockImplementation(async (request, options) => {
        if (request.headers["x-amz-target"] !== "DynamoDB_20120810.GetItem")
          return handle(request, options);
        signals.push(options?.abortSignal);
        if (++readCount !== heldRead) return handle(request, options);
        try {
          return await new Promise<never>((_resolve, reject) => {
            const signal = options?.abortSignal;
            const onAbort = () => {
              aborted = true;
              clearTimeout(watchdog);
              if (signal) signal.onabort = null;
              reject(
                Object.assign(new Error("generated read aborted"), {
                  name: "AbortError",
                }),
              );
            };
            const watchdog = setTimeout(() => {
              watchdogFired = true;
              if (signal) signal.onabort = null;
              reject(
                Object.assign(new Error("generated held read watchdog"), {
                  name: "AbortError",
                }),
              );
            }, 1500);
            if (signal) signal.onabort = onAbort;
            entered();
            if (signal?.aborted) onAbort();
          });
        } finally {
          readSettled = true;
        }
      });
    const heldClient = new DynamoDBClient({
      endpoint: process.env.DEPLOYMENT_TEST_DYNAMODB_ENDPOINT,
      region: "local",
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
      requestHandler: handler,
      maxAttempts: 1,
    });
    const heldService = createRecordingCheckpointService({
      repository: createDynamoDeploymentControlRepository(heldClient, tables),
      objects: {
        upload: async (key, body) => {
          if (!objects.has(key)) objects.set(key, Buffer.from(body));
          return key;
        },
        read: async (key) => objects.get(key),
      },
    });
    try {
      const pending = heldService.preserveTerminalRecordingCheckpoint({
        ...terminal,
        preservation: {
          ...terminal.preservation,
          signal: controller.signal,
          deadlineEpochMs:
            Date.now() + (cancellation === "deadline" ? 500 : 10000),
        },
      });
      await atRead;
      if (cancellation === "abort") controller.abort();
      expect((await pending).kind).toBe("preservation_failed");
      expect(readSettled).toBe(true);
      expect(watchdogFired).toBe(false);
      expect(aborted).toBe(true);
      expect(signals).toHaveLength(heldRead);
      expect(signals.every((signal) => signal === signals[0])).toBe(true);
      const row = await repository.getMeetingHistory({
        guildId: history.guildId,
        channelId_timestamp: history.channelId_timestamp,
      });
      expect(row?.checkpoint).toEqual(terminal.previous);
      expect(row?.recovery).toBeUndefined();
    } finally {
      heldClient.destroy();
    }
  },
);
