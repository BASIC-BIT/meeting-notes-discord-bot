/** @jest-environment node */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as dynamo from "@aws-sdk/client-dynamodb";

test.each([false, true])(
  "local initialization preserves existing data and upgrades only a missing index: %s",
  async (exists) => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof dynamo.DescribeTableCommand)
        return {
          Table: {
            GlobalSecondaryIndexes: exists
              ? [{ IndexName: "RenewalRecoveryDueIndex" }]
              : [],
          },
        };
      if (command instanceof dynamo.DescribeTimeToLiveCommand)
        return { TimeToLiveDescription: { TimeToLiveStatus: "ENABLED" } };
      return {};
    });
    const source = readFileSync("scripts/init-dynamodb.js", "utf8");
    const end = source.lastIndexOf("createTables().catch");
    expect(end).toBeGreaterThan(0);
    await runInNewContext(source.slice(0, end) + "createTables();", {
      require: (name: string) =>
        name === "dotenv"
          ? { config() {} }
          : {
              ...dynamo,
              DynamoDBClient: class {
                send = send;
              },
            },
      console: { log() {}, error() {} },
      process: { env: {} },
      setTimeout,
    });
    const updates = send.mock.calls
      .map((call) => call[0])
      .filter((command) => command instanceof dynamo.UpdateTableCommand);
    expect(updates).toHaveLength(exists ? 0 : 1);
    if (!exists)
      expect(updates[0].input).toMatchObject({
        TableName: "GuildSubscriptionTable",
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: "RenewalRecoveryDueIndex",
              Projection: { ProjectionType: "KEYS_ONLY" },
            },
          },
        ],
      });
    expect(
      send.mock.calls.some(
        (call) => call[0] instanceof dynamo.DeleteTableCommand,
      ),
    ).toBe(false);
  },
);

test("Terraform exposes only the exact recovery due index to the task role", () => {
  const source = readFileSync("_infra/main.tf", "utf8");
  expect(source).toContain(
    "${aws_dynamodb_table.guild_subscription_table.arn}/index/RenewalRecoveryDueIndex",
  );
  expect(source).toContain('projection_type = "KEYS_ONLY"');
});
