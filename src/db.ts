import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccessLog,
  PaymentTransaction,
  RecordingTranscript,
  Subscription,
} from "./types/db";

const dynamoDbClient = new DynamoDBClient({ region: "us-east-1" });

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
