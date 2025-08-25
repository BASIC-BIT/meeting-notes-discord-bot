const {
  DynamoDBClient,
  CreateTableCommand,
} = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({
  endpoint: "http://localhost:8000",
  region: "local",
  credentials: {
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
});

const tables = [
  {
    TableName: "SubscriptionTable",
    KeySchema: [{ AttributeName: "UserID", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "UserID", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: "PaymentTransactionTable",
    KeySchema: [{ AttributeName: "TransactionID", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "TransactionID", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: "AccessLogsTable",
    KeySchema: [{ AttributeName: "AccessLogID", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "AccessLogID", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: "RecordingTranscriptTable",
    KeySchema: [{ AttributeName: "MeetingID", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "MeetingID", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: "AutoRecordSettingsTable",
    KeySchema: [
      { AttributeName: "guildId", KeyType: "HASH" },
      { AttributeName: "channelId", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "guildId", AttributeType: "S" },
      { AttributeName: "channelId", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "GuildRecordAllIndex",
        KeySchema: [{ AttributeName: "guildId", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
];

async function waitForDynamoDB(maxRetries = 10, delay = 1000) {
  const { ListTablesCommand } = require("@aws-sdk/client-dynamodb");

  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.send(new ListTablesCommand({}));
      console.log("✅ Connected to DynamoDB Local");
      return true;
    } catch {
      if (i === maxRetries - 1) {
        throw new Error(
          "Could not connect to DynamoDB Local. Is Docker running?",
        );
      }
      console.log(
        `⏳ Waiting for DynamoDB Local to be ready... (attempt ${i + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return false;
}

async function createTables() {
  console.log("Initializing DynamoDB tables...");
  console.log("Connecting to DynamoDB at http://localhost:8000");

  try {
    await waitForDynamoDB();
  } catch (error) {
    console.error("\n❌ " + error.message);
    console.error("\nPlease make sure DynamoDB Local is running:");
    console.error("  yarn docker:up");
    console.error("\nOr use the combined command:");
    console.error("  yarn dev");
    process.exit(1);
  }

  for (const table of tables) {
    try {
      await client.send(new CreateTableCommand(table));
      console.log(`✅ Created table: ${table.TableName}`);
    } catch (error) {
      if (error.name === "ResourceInUseException") {
        console.log(`⚠️  Table ${table.TableName} already exists`);
      } else {
        console.error(
          `❌ Error creating table ${table.TableName}:`,
          error.message,
        );
      }
    }
  }

  console.log("\nDynamoDB initialization complete!");
  console.log("You can view your tables at http://localhost:8001");
}

createTables().catch((error) => {
  console.error("Failed to initialize DynamoDB:", error);
  process.exit(1);
});
