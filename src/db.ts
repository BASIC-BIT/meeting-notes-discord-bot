import { config } from "./services/configService";
import {
  AttributeValue,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccessLog,
  AutoRecordSettings,
  ChannelContext,
  GuildSubscription,
  MeetingHistory,
  NotesHistoryEntry,
  AskConversationRecord,
  AskMessageRecord,
  GuildInstaller,
  OnboardingState,
  PaymentTransaction,
  RecordingTranscript,
  ServerContext,
  StripeWebhookEvent,
  SuggestionHistoryEntry,
} from "./types/db";

const dynamoDbClient = new DynamoDBClient(
  config.database.useLocalDynamoDB
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

const tablePrefix = config.database.tablePrefix ?? "";
const tableName = (name: string) => `${tablePrefix}${name}`;

// Guild Subscription Table
export async function writeGuildSubscription(
  subscription: GuildSubscription,
): Promise<void> {
  const params = {
    TableName: tableName("GuildSubscriptionTable"),
    Item: marshall(subscription, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getGuildSubscription(
  guildId: string,
): Promise<GuildSubscription | undefined> {
  const params = {
    TableName: tableName("GuildSubscriptionTable"),
    Key: marshall({ guildId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as GuildSubscription;
  }
  return undefined;
}

// Write to PaymentTransaction Table
export async function writePaymentTransaction(
  transaction: PaymentTransaction,
): Promise<void> {
  const params = {
    TableName: tableName("PaymentTransactionTable"),
    Item: marshall(transaction),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

// Stripe Webhook Event Table (idempotency)
export async function writeStripeWebhookEvent(
  event: StripeWebhookEvent,
): Promise<void> {
  const params = {
    TableName: tableName("StripeWebhookEventTable"),
    Item: marshall(event, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getStripeWebhookEvent(
  eventId: string,
): Promise<StripeWebhookEvent | undefined> {
  const params = {
    TableName: tableName("StripeWebhookEventTable"),
    Key: marshall({ eventId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as StripeWebhookEvent;
  }
  return undefined;
}

// Read from PaymentTransaction Table
export async function getPaymentTransaction(
  transactionID: string,
): Promise<PaymentTransaction | undefined> {
  const params = {
    TableName: tableName("PaymentTransactionTable"),
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
    TableName: tableName("AccessLogsTable"),
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
    TableName: tableName("AccessLogsTable"),
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
    TableName: tableName("RecordingTranscriptTable"),
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
    TableName: tableName("RecordingTranscriptTable"),
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
    TableName: tableName("AutoRecordSettingsTable"),
    Item: marshall(setting, { removeUndefinedValues: true }),
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
    TableName: tableName("AutoRecordSettingsTable"),
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
    TableName: tableName("AutoRecordSettingsTable"),
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
    TableName: tableName("AutoRecordSettingsTable"),
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
    TableName: tableName("AutoRecordSettingsTable"),
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

// Server Context operations
export async function writeServerContext(
  context: ServerContext,
): Promise<void> {
  const params = {
    TableName: tableName("ServerContextTable"),
    Item: marshall(context, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getServerContext(
  guildId: string,
): Promise<ServerContext | undefined> {
  const params = {
    TableName: tableName("ServerContextTable"),
    Key: marshall({ guildId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as ServerContext;
  }
  return undefined;
}

export async function deleteServerContext(guildId: string): Promise<void> {
  const params = {
    TableName: tableName("ServerContextTable"),
    Key: marshall({ guildId }),
  };
  const command = new DeleteItemCommand(params);
  await dynamoDbClient.send(command);
}

// Channel Context operations
export async function writeChannelContext(
  context: ChannelContext,
): Promise<void> {
  const params = {
    TableName: tableName("ChannelContextTable"),
    Item: marshall(context, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getChannelContext(
  guildId: string,
  channelId: string,
): Promise<ChannelContext | undefined> {
  const params = {
    TableName: tableName("ChannelContextTable"),
    Key: marshall({ guildId, channelId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as ChannelContext;
  }
  return undefined;
}

export async function getAllChannelContexts(
  guildId: string,
): Promise<ChannelContext[]> {
  const params = {
    TableName: tableName("ChannelContextTable"),
    KeyConditionExpression: "guildId = :guildId",
    ExpressionAttributeValues: marshall({
      ":guildId": guildId,
    }),
  };
  const command = new QueryCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map((item) => unmarshall(item) as ChannelContext);
  }
  return [];
}

export async function deleteChannelContext(
  guildId: string,
  channelId: string,
): Promise<void> {
  const params = {
    TableName: tableName("ChannelContextTable"),
    Key: marshall({ guildId, channelId }),
  };
  const command = new DeleteItemCommand(params);
  await dynamoDbClient.send(command);
}

// Guild installer mapping
export async function writeGuildInstaller(
  installer: GuildInstaller,
): Promise<void> {
  const params = {
    TableName: tableName("InstallerTable"),
    Item: marshall(installer),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getGuildInstaller(
  guildId: string,
): Promise<GuildInstaller | undefined> {
  const params = {
    TableName: tableName("InstallerTable"),
    Key: marshall({ guildId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as GuildInstaller;
  }
  return undefined;
}

// Onboarding state helpers
export async function writeOnboardingState(
  state: OnboardingState,
): Promise<void> {
  const params = {
    TableName: tableName("OnboardingStateTable"),
    Item: marshall(state, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getOnboardingState(
  guildId: string,
  userId: string,
): Promise<OnboardingState | undefined> {
  const params = {
    TableName: tableName("OnboardingStateTable"),
    Key: marshall({ guildId, userId }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as OnboardingState;
  }
  return undefined;
}

export async function deleteOnboardingState(
  guildId: string,
  userId: string,
): Promise<void> {
  const params = {
    TableName: tableName("OnboardingStateTable"),
    Key: marshall({ guildId, userId }),
  };
  const command = new DeleteItemCommand(params);
  await dynamoDbClient.send(command);
}

// Meeting History operations
export async function writeMeetingHistory(
  history: MeetingHistory,
): Promise<void> {
  const params = {
    TableName: tableName("MeetingHistoryTable"),
    Item: marshall(history, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function getRecentMeetingsForChannel(
  guildId: string,
  channelId: string,
  limit: number = 5,
): Promise<MeetingHistory[]> {
  const params = {
    TableName: tableName("MeetingHistoryTable"),
    KeyConditionExpression:
      "guildId = :guildId AND begins_with(channelId_timestamp, :channelId)",
    ExpressionAttributeValues: marshall({
      ":guildId": guildId,
      ":channelId": `${channelId}#`,
    }),
    ScanIndexForward: false, // Get most recent first
    Limit: limit,
  };
  const command = new QueryCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map((item) => unmarshall(item) as MeetingHistory);
  }
  return [];
}

export async function getRecentMeetingsForGuild(
  guildId: string,
  limit: number = 10,
): Promise<MeetingHistory[]> {
  const params = {
    TableName: tableName("MeetingHistoryTable"),
    IndexName: "GuildTimestampIndex",
    KeyConditionExpression: "guildId = :guildId",
    ExpressionAttributeValues: marshall({
      ":guildId": guildId,
    }),
    ScanIndexForward: false, // Get most recent first
    Limit: limit,
  };
  const command = new QueryCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map((item) => unmarshall(item) as MeetingHistory);
  }
  return [];
}

export async function getMeetingsForGuildInRange(
  guildId: string,
  startTimestamp: string,
  endTimestamp: string,
): Promise<MeetingHistory[]> {
  const items: MeetingHistory[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;

  do {
    const params = {
      TableName: tableName("MeetingHistoryTable"),
      IndexName: "GuildTimestampIndex",
      KeyConditionExpression:
        "guildId = :guildId AND #timestamp BETWEEN :start AND :end",
      ExpressionAttributeNames: { "#timestamp": "timestamp" },
      ExpressionAttributeValues: marshall({
        ":guildId": guildId,
        ":start": startTimestamp,
        ":end": endTimestamp,
      }),
      ExclusiveStartKey: lastKey,
    };
    const command = new QueryCommand(params);
    const result = await dynamoDbClient.send(command);
    if (result.Items) {
      items.push(
        ...result.Items.map((item) => unmarshall(item) as MeetingHistory),
      );
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

export async function getMeetingHistory(
  guildId: string,
  channelId_timestamp: string,
): Promise<MeetingHistory | undefined> {
  const params = {
    TableName: tableName("MeetingHistoryTable"),
    Key: marshall({ guildId, channelId_timestamp }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as MeetingHistory;
  }
  return undefined;
}

export async function updateMeetingNotes(
  guildId: string,
  channelId_timestamp: string,
  notes: string,
  notesVersion: number,
  editedBy: string,
  suggestion?: SuggestionHistoryEntry,
  expectedPreviousVersion?: number,
  metadata?: {
    notesMessageIds?: string[];
    notesChannelId?: string;
  },
): Promise<boolean> {
  const now = new Date().toISOString();
  const notesHistoryEntry: NotesHistoryEntry = {
    version: notesVersion,
    notes,
    editedBy,
    editedAt: now,
  };

  const updateParts = [
    "#notes = :notes",
    "#notesVersion = :notesVersion",
    "#updatedAt = :updatedAt",
    "#notesLastEditedBy = :editedBy",
    "#notesLastEditedAt = :editedAt",
    "#notesHistory = list_append(if_not_exists(#notesHistory, :emptyList), :notesHistoryEntry)",
  ];

  if (suggestion) {
    updateParts.push(
      "#suggestionsHistory = list_append(if_not_exists(#suggestionsHistory, :emptyList), :suggestionEntry)",
    );
  }

  if (metadata?.notesMessageIds) {
    updateParts.push("#notesMessageIds = :notesMessageIds");
  }

  if (metadata?.notesChannelId) {
    updateParts.push("#notesChannelId = :notesChannelId");
  }

  const expressionAttributeNames: Record<string, string> = {
    "#notes": "notes",
    "#notesVersion": "notesVersion",
    "#updatedAt": "updatedAt",
    "#notesLastEditedBy": "notesLastEditedBy",
    "#notesLastEditedAt": "notesLastEditedAt",
    "#notesHistory": "notesHistory",
  };

  if (suggestion) {
    expressionAttributeNames["#suggestionsHistory"] = "suggestionsHistory";
  }

  if (metadata?.notesMessageIds) {
    expressionAttributeNames["#notesMessageIds"] = "notesMessageIds";
  }

  if (metadata?.notesChannelId) {
    expressionAttributeNames["#notesChannelId"] = "notesChannelId";
  }

  const values: Record<string, unknown> = {
    ":notes": notes,
    ":notesVersion": notesVersion,
    ":updatedAt": now,
    ":editedBy": editedBy,
    ":editedAt": now,
    ":notesHistoryEntry": [notesHistoryEntry],
    ":emptyList": [],
  };

  if (suggestion) {
    values[":suggestionEntry"] = [suggestion];
  }

  if (metadata?.notesMessageIds) {
    values[":notesMessageIds"] = metadata.notesMessageIds;
  }

  if (metadata?.notesChannelId) {
    values[":notesChannelId"] = metadata.notesChannelId;
  }

  if (expectedPreviousVersion !== undefined) {
    values[":expectedVersion"] = expectedPreviousVersion;
  }

  const params: UpdateItemCommand["input"] = {
    TableName: tableName("MeetingHistoryTable"),
    Key: marshall({ guildId, channelId_timestamp }),
    UpdateExpression: `SET ${updateParts.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: marshall(values, {
      removeUndefinedValues: true,
    }),
  };

  if (expectedPreviousVersion !== undefined) {
    params.ConditionExpression =
      "attribute_not_exists(#notesVersion) OR #notesVersion = :expectedVersion";
  }

  const command = new UpdateItemCommand(params);
  try {
    await dynamoDbClient.send(command);
    return true;
  } catch (error) {
    if (
      (error as { name?: string }).name === "ConditionalCheckFailedException"
    ) {
      return false;
    }

    console.error("Failed to update meeting notes:", error);
    return false;
  }
}

function buildAskPartitionKey(userId: string, guildId: string) {
  return `USER#${userId}#GUILD#${guildId}`;
}

export async function listAskConversations(
  userId: string,
  guildId: string,
): Promise<AskConversationRecord[]> {
  const pk = buildAskPartitionKey(userId, guildId);
  const params = {
    TableName: tableName("AskConversationTable"),
    KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
    ExpressionAttributeValues: marshall({
      ":pk": pk,
      ":prefix": "CONV#",
    }),
  };
  const command = new QueryCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map(
      (item) => unmarshall(item) as AskConversationRecord,
    );
  }
  return [];
}

export async function getAskConversation(
  userId: string,
  guildId: string,
  conversationId: string,
): Promise<AskConversationRecord | undefined> {
  const pk = buildAskPartitionKey(userId, guildId);
  const sk = `CONV#${conversationId}`;
  const params = {
    TableName: tableName("AskConversationTable"),
    Key: marshall({ pk, sk }),
  };
  const command = new GetItemCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Item) {
    return unmarshall(result.Item) as AskConversationRecord;
  }
  return undefined;
}

export async function listAskMessages(
  userId: string,
  guildId: string,
  conversationId: string,
): Promise<AskMessageRecord[]> {
  const pk = buildAskPartitionKey(userId, guildId);
  const params = {
    TableName: tableName("AskConversationTable"),
    KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
    ExpressionAttributeValues: marshall({
      ":pk": pk,
      ":prefix": `MSG#${conversationId}#`,
    }),
  };
  const command = new QueryCommand(params);
  const result = await dynamoDbClient.send(command);
  if (result.Items) {
    return result.Items.map((item) => unmarshall(item) as AskMessageRecord);
  }
  return [];
}

export async function writeAskConversation(
  record: AskConversationRecord,
): Promise<void> {
  const params = {
    TableName: tableName("AskConversationTable"),
    Item: marshall(record, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function writeAskMessage(record: AskMessageRecord): Promise<void> {
  const params = {
    TableName: tableName("AskConversationTable"),
    Item: marshall(record, { removeUndefinedValues: true }),
  };
  const command = new PutItemCommand(params);
  await dynamoDbClient.send(command);
}

export async function updateMeetingTags(
  guildId: string,
  channelId_timestamp: string,
  tags?: string[],
): Promise<void> {
  const params: UpdateItemCommand["input"] = {
    TableName: tableName("MeetingHistoryTable"),
    Key: marshall({ guildId, channelId_timestamp }),
    UpdateExpression: "SET #tags = :tags",
    ExpressionAttributeNames: {
      "#tags": "tags",
    },
    ExpressionAttributeValues: marshall(
      {
        ":tags": tags ?? [],
      },
      { removeUndefinedValues: false },
    ),
  };

  const command = new UpdateItemCommand(params);
  await dynamoDbClient.send(command);
}
