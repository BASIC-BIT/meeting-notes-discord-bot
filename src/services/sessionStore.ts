import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import session, { SessionData } from "express-session";
import { config } from "./configService";

interface DynamoSession {
  sid: string;
  data: string;
  expiresAt: number;
}

export class DynamoSessionStore extends session.Store {
  private tableName = "SessionTable";
  private client: DynamoDBClient;
  private ttlSeconds: number;

  constructor() {
    super();
    this.ttlSeconds = config.server.sessionTtlSeconds; // default 7 days

    this.client = new DynamoDBClient(
      config.database.useLocalDynamoDB
        ? {
            endpoint: "http://localhost:8000",
            region: "local",
            credentials: {
              accessKeyId: "dummy",
              secretAccessKey: "dummy",
            },
          }
        : { region: config.storage.awsRegion },
    );
  }

  async get(
    sid: string,
    cb: (err?: Error | null, session?: SessionData | null) => void,
  ) {
    try {
      const res = await this.client.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ sid }),
        }),
      );
      if (!res.Item) {
        cb(null, null);
        return;
      }
      const item = unmarshall(res.Item) as DynamoSession;
      const json = JSON.parse(item.data);
      cb(null, json);
    } catch (err) {
      cb(err as Error);
    }
  }

  async set(
    sid: string,
    sessionData: SessionData,
    cb: (err?: Error | null) => void = () => {},
  ) {
    try {
      const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall({
            sid,
            data: JSON.stringify(sessionData),
            expiresAt,
          }),
        }),
      );
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  async destroy(sid: string, cb: (err?: Error | null) => void = () => {}) {
    try {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({ sid }),
        }),
      );
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  async touch(
    sid: string,
    sessionData: SessionData,
    cb: (err?: Error | null) => void = () => {},
  ) {
    // Refresh expiry by re-setting
    await this.set(sid, sessionData, cb);
  }
}
