import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccessLog,
  AutoRecordSettings,
  PaymentTransaction,
  RecordingTranscript,
  Subscription,
} from "./types/db";

const dynamoDbClient = new DynamoDBClient(
  process.env.NODE_ENV === "development" &&
  process.env.USE_LOCAL_DYNAMODB === "true"
    ? {
        endpoint: "http://localhost:8000",
        region: "local",
        credentials: {
          accessKeyId: "dummy",
          secretAccessKey: "dummy",
        },
      }
    : { region: "us-east-1" },
);

// Write to Subscription Table
export async function writeSubscription(
  subscription: Subscription,
): Promise<void> {
  const params = {
    TableName: "SubscriptionTable",
    Item: marshall(subscription),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

// Read from Subscription Table
export async function getSubscription(
  userID: string,
): Promise<Subscription | undefined> {
  const params = {
    TableName: "SubscriptionTable",
    Key: marshall({ UserID: userID }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as Subscription;
  }
  return undefined;
}

// Write to PaymentTransaction Table
export async function writePaymentTransaction(
  transaction: PaymentTransaction,
): Promise<void> {
  const params = {
    TableName: "PaymentTransactionTable",
    Item: marshall(transaction),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

// Read from PaymentTransaction Table
export async function getPaymentTransaction(
  transactionID: string,
): Promise<PaymentTransaction | undefined> {
  const params = {
    TableName: "PaymentTransactionTable",
    Key: marshall({ TransactionID: transactionID }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as PaymentTransaction;
  }
  return undefined;
}

// Write to AccessLog Table
export async function writeAccessLog(accessLog: AccessLog): Promise<void> {
  const params = {
    TableName: "AccessLogsTable",
    Item: marshall(accessLog),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

// Read from AccessLog Table
export async function getAccessLog(
  accessLogID: string,
): Promise<AccessLog | undefined> {
  const params = {
    TableName: "AccessLogsTable",
    Key: marshall({ AccessLogID: accessLogID }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as AccessLog;
  }
  return undefined;
}

// Write to RecordingTranscript Table
export async function writeRecordingTranscript(
  recordingTranscript: RecordingTranscript,
): Promise<void> {
  const params = {
    TableName: "RecordingTranscriptTable",
    Item: marshall(recordingTranscript),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

// Read from RecordingTranscript Table
export async function getRecordingTranscript(
  meetingID: string,
): Promise<RecordingTranscript | undefined> {
  const params = {
    TableName: "RecordingTranscriptTable",
    Key: marshall({ MeetingID: meetingID }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as RecordingTranscript;
  }
  return undefined;
}

// Write AutoRecordSettings
export async function writeAutoRecordSetting(
  setting: AutoRecordSettings,
): Promise<void> {
  const params = {
    TableName: "AutoRecordSettingsTable",
    Item: marshall(setting),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

// Get specific AutoRecordSetting
export async function getAutoRecordSetting(
  guildId: string,
  channelId: string,
): Promise<AutoRecordSettings | undefined> {
  const params = {
    TableName: "AutoRecordSettingsTable",
    Key: marshall({ guildId, channelId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as AutoRecordSettings;
  }
  return undefined;
}

// Get all AutoRecordSettings for a guild
export async function getAllAutoRecordSettings(
  guildId: string,
): Promise<AutoRecordSettings[]> {
  const params = {
    TableName: "AutoRecordSettingsTable",
    KeyConditionExpression: "guildId = :guildId",
    ExpressionAttributeValues: marshall({
      ":guildId": guildId,
    }),
  };
  const command = new QueryCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map((item) => unmarshall(item) as AutoRecordSettings);
  }
  return [];
}

// Delete AutoRecordSetting
export async function deleteAutoRecordSetting(
  guildId: string,
  channelId: string,
): Promise<void> {
  const params = {
    TableName: "AutoRecordSettingsTable",
    Key: marshall({ guildId, channelId }),
  };
  const command = new DeleteItemCommand(params);
  await dynamoDbClient.send(command);
}

// Scan for all guilds with recordAll enabled
export async function scanAutoRecordSettingsForRecordAll(): Promise<
  AutoRecordSettings[]
> {
  const params = {
    TableName: "AutoRecordSettingsTable",
    FilterExpression: "recordAll = :recordAll AND enabled = :enabled",
    ExpressionAttributeValues: marshall({
      ":recordAll": true,
      ":enabled": true,
    }),
  };
  const command = new ScanCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map((item) => unmarshall(item) as AutoRecordSettings);
  }
  return [];
}
