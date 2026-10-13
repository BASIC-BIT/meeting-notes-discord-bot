import { randomUUID } from "node:crypto";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  classifyDeploymentTransactionError,
  createDynamoDeploymentControlRepository,
  DeploymentControlError,
} from "../../src/repositories/deploymentControlRepository";
import { buildRuntimeAdmissionChecks } from "../../src/services/deploymentControlTransactions";
import {
  context,
  control,
  runtime,
  promotion,
  history,
} from "./controlFixtures";

const prefix = `deployment-test-${randomUUID()}-`;
const tables = {
  deploymentControl: `${prefix}DeploymentControlTable`,
  meetingHistory: `${prefix}MeetingHistoryTable`,
};
const client = new DynamoDBClient({
  endpoint: process.env.DEPLOYMENT_TEST_DYNAMODB_ENDPOINT,
  region: "local",
  credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
});
const repository = createDynamoDeploymentControlRepository(client, tables);
const created: string[] = [];

beforeAll(async () => {
  for (const [name, keys] of [
    [tables.deploymentControl, ["pk", "sk"]],
    [tables.meetingHistory, ["guildId", "channelId_timestamp"]],
  ] as const) {
    await client.send(
      new CreateTableCommand({
        TableName: name,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: keys[0], KeyType: "HASH" },
          { AttributeName: keys[1], KeyType: "RANGE" },
        ],
        AttributeDefinitions: keys.map((AttributeName) => ({
          AttributeName,
          AttributeType: "S",
        })),
      }),
    );
    created.push(name);
  }
});
afterAll(async () => {
  for (const TableName of created)
    await client.send(new DeleteTableCommand({ TableName }));
  client.destroy();
});
beforeEach(async () => {
  await client.send(
    new PutItemCommand({
      TableName: tables.deploymentControl,
      Item: marshall(control),
    }),
  );
  for (const row of [runtime("old"), runtime("new", "candidate")]) {
    await client.send(
      new PutItemCommand({
        TableName: tables.deploymentControl,
        Item: marshall(row),
      }),
    );
  }
});

async function oldStart(guild: string) {
  try {
    await client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          ...buildRuntimeAdmissionChecks(context, tables),
          {
            Put: {
              TableName: tables.meetingHistory,
              Item: marshall({
                guildId: guild,
                channelId_timestamp: "reservation",
                status: "starting",
              }),
              ConditionExpression: "attribute_not_exists(guildId)",
            },
          },
        ],
      }),
    );
    return { kind: "admitted" };
  } catch (error) {
    if (classifyDeploymentTransactionError(error) === "stale")
      return { kind: "blocked" };
    throw error;
  }
}

test("promotionAndOldAdmissionHaveOnlyTwoLegalOrders", async () => {
  const oldStartBeforePromotion = await oldStart("before");
  expect(oldStartBeforePromotion.kind).toBe("admitted");
  expect(await repository.promote(promotion)).toBe("applied");
  const oldStartAfterPromotion = await oldStart("after");
  expect(oldStartAfterPromotion.kind).toBe("blocked");
  expect(
    (
      await client.send(
        new GetItemCommand({
          TableName: tables.meetingHistory,
          Key: marshall({
            guildId: "after",
            channelId_timestamp: "reservation",
          }),
        }),
      )
    ).Item,
  ).toBeUndefined();
  expect(
    (
      await repository.checkAdmission({
        ...context,
        instanceId: "new",
        authorizedGeneration: 8,
      })
    ).kind,
  ).toBe("admitted");
});

test("concurrent promotion and old admission serialize without post-promotion writes", async () => {
  async function retryConflict<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const conflict =
          error instanceof DeploymentControlError
            ? error.kind === "conflict"
            : classifyDeploymentTransactionError(error) === "conflict";
        if (!conflict || attempt >= 5) throw error;
      }
    }
  }
  const [admission, promoted] = await Promise.all([
    retryConflict(() => oldStart("race")),
    retryConflict(() => repository.promote(promotion)),
  ]);
  expect(promoted).toBe("applied");
  const row = await client.send(
    new GetItemCommand({
      TableName: tables.meetingHistory,
      Key: marshall({ guildId: "race", channelId_timestamp: "reservation" }),
      ConsistentRead: true,
    }),
  );
  expect(Boolean(row.Item)).toBe(admission.kind === "admitted");
  expect((await oldStart("race-after")).kind).toBe("blocked");
});

test("missingControlRejectsAdmission", async () => {
  // Remove only this run's control item, leaving the ready runtime in place.
  const { DeleteItemCommand } = await import("@aws-sdk/client-dynamodb");
  await client.send(
    new DeleteItemCommand({
      TableName: tables.deploymentControl,
      Key: marshall({ pk: "ENV", sk: "CONTROL" }),
    }),
  );
  expect((await repository.checkAdmission(context)).kind).toBe("blocked");
});

test("staleEpochCannotPromote", async () => {
  expect(await repository.promote({ ...promotion, coordinatorEpoch: 2 })).toBe(
    "stale",
  );
  expect((await repository.checkAdmission(context)).kind).toBe("admitted");
});

test("lateInitialHistoryCannotOverwriteProgress", async () => {
  expect(await repository.createInitialMeetingHistory(history)).toBe("applied");
  const key = {
    guildId: history.guildId,
    channelId_timestamp: history.channelId_timestamp,
  };
  expect(
    await repository.transitionMeetingHistory({
      key,
      expectedMeetingId: "meeting",
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus: "starting",
      patch: { status: "processing" },
    }),
  ).toBe("applied");
  expect(await repository.createInitialMeetingHistory(history)).toBe("stale");
  const finalRow = await repository.getMeetingHistory(key);
  expect(finalRow?.status).toBe("processing");
  expect(finalRow?.executionVersion).toBe(1);
});

test("ordinary history progress preserves the execution attempt fence", async () => {
  const row = { ...history, guildId: "attempt-fence" };
  await repository.createInitialMeetingHistory(row);
  const key = {
    guildId: row.guildId,
    channelId_timestamp: row.channelId_timestamp,
  };
  for (const [expectedStatus, status] of [
    ["starting", "in_progress"],
    ["in_progress", "processing"],
  ] as const) {
    const transition = {
      key,
      expectedMeetingId: "meeting",
      expectedOwnerInstanceId: "old",
      expectedExecutionVersion: 1,
      expectedStatus,
      patch: { status },
    };
    expect(
      await repository.transitionMeetingHistory({
        ...transition,
        expectedExecutionVersion: 2,
      }),
    ).toBe("stale");
    expect(
      await repository.transitionMeetingHistory({
        ...transition,
        expectedOwnerInstanceId: "former-owner",
      }),
    ).toBe("stale");
    expect(await repository.transitionMeetingHistory(transition)).toBe(
      "applied",
    );
    expect(await repository.getMeetingHistory(key)).toMatchObject({
      status,
      executionVersion: 1,
      ownerInstanceId: "old",
    });
    expect(await repository.transitionMeetingHistory(transition)).toBe("stale");
  }
});

test("ttlNeverDeletesUnsettledVoice", async () => {
  await repository.writeVoice({
    pk: "VOICE#guild",
    sk: "STATE",
    recordType: "voice",
    protocolVersion: 1,
    guildId: "guild",
    meetingId: "meeting",
    ownerInstanceId: "old",
    attemptId: "attempt",
    state: "uncertain",
    updatedAt: 100,
  });
  const response = await client.send(
    new GetItemCommand({
      TableName: tables.deploymentControl,
      Key: marshall({ pk: "VOICE#guild", sk: "STATE" }),
    }),
  );
  const voiceRecord = unmarshall(response.Item!);
  expect(voiceRecord.expiresAt).toBeUndefined();
});

test.each([
  {
    name: "readiness expires",
    change: (row: ReturnType<typeof runtime>) => {
      row.readiness.expiresAt = 100;
    },
  },
  {
    name: "protection expires",
    change: (row: ReturnType<typeof runtime>) => {
      row.protection.expiresAt = 100;
    },
  },
  {
    name: "wrong epoch",
    change: (row: ReturnType<typeof runtime>) => {
      row.readiness.observedEpoch = 2;
    },
  },
  {
    name: "wrong generation",
    change: (row: ReturnType<typeof runtime>) => {
      row.readiness.observedGeneration = 6;
    },
  },
  {
    name: "gateway unavailable",
    change: (row: ReturnType<typeof runtime>) => {
      row.readiness.gatewayReady = false;
    },
  },
  {
    name: "dependencies unavailable",
    change: (row: ReturnType<typeof runtime>) => {
      row.readiness.dependenciesReady = false;
    },
  },
  {
    name: "future proof",
    change: (row: ReturnType<typeof runtime>) => {
      row.protection.provenAt = 101;
    },
  },
])("admission and promotion reject $name", async ({ change }) => {
  for (const row of [runtime("old"), runtime("new", "candidate")]) {
    change(row);
    await repository.writeRuntime(row);
  }
  expect((await repository.checkAdmission(context)).kind).toBe("blocked");
  expect(await repository.promote(promotion)).toBe("stale");
});

test("a stale heartbeat cannot undo promotion", async () => {
  const before = runtime("new", "candidate");
  expect(await repository.promote(promotion)).toBe("applied");
  expect(await repository.writeRuntime(before)).toBe("stale");
  expect(
    (
      await repository.checkAdmission({
        ...context,
        instanceId: "new",
        authorizedGeneration: 8,
      })
    ).kind,
  ).toBe("admitted");
});

test("wrong owner, meeting, version and prior status cannot update history", async () => {
  const row = { ...history, guildId: "cas" };
  await repository.createInitialMeetingHistory(row);
  const transition = {
    key: { guildId: row.guildId, channelId_timestamp: row.channelId_timestamp },
    expectedMeetingId: "meeting",
    expectedOwnerInstanceId: "old",
    expectedExecutionVersion: 1,
    expectedStatus: "starting" as const,
    patch: { status: "processing" as const },
  };
  for (const mismatch of [
    { expectedMeetingId: "other" },
    { expectedOwnerInstanceId: "other" },
    { expectedExecutionVersion: 2 },
    { expectedStatus: "in_progress" as const },
  ]) {
    expect(
      await repository.transitionMeetingHistory({ ...transition, ...mismatch }),
    ).toBe("stale");
  }
  expect((await repository.getMeetingHistory(transition.key))?.status).toBe(
    "starting",
  );
});

test("unsettled voice cannot be replaced without the current attempt", async () => {
  const voice = {
    pk: "VOICE#cas",
    sk: "STATE" as const,
    recordType: "voice" as const,
    protocolVersion: 1 as const,
    guildId: "cas",
    meetingId: "meeting",
    ownerInstanceId: "old",
    attemptId: "first",
    state: "uncertain" as const,
    updatedAt: 100,
  };
  expect(await repository.writeVoice(voice)).toBe("applied");
  expect(await repository.writeVoice({ ...voice, attemptId: "second" })).toBe(
    "stale",
  );
  expect(
    await repository.writeVoice(
      { ...voice, state: "settled" },
      { ...voice, attemptId: "wrong" },
    ),
  ).toBe("stale");
  expect(await repository.getRecord(voice.pk, voice.sk)).toMatchObject({
    attemptId: "first",
    state: "uncertain",
  });
  expect(
    await repository.writeVoice({ ...voice, attemptId: "second" }, voice),
  ).toBe("stale");
  expect(
    await repository.writeVoice({ ...voice, state: "settled" }, voice),
  ).toBe("applied");
  expect(
    await repository.writeVoice({ ...voice, state: "connected" }, voice),
  ).toBe("stale");
});
