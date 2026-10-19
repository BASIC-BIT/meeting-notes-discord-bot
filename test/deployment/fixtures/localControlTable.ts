import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
export function localControlTable() {
  const client = new DynamoDBClient({
    region: "local",
    endpoint: process.env.DEPLOYMENT_TEST_DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
  });
  const createTable = (TableName: string) =>
    client.send(
      new CreateTableCommand({
        TableName,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: ["pk", "sk"].map((AttributeName, index) => ({
          AttributeName,
          KeyType: index === 0 ? "HASH" : "RANGE",
        })),
        AttributeDefinitions: ["pk", "sk"].map((AttributeName) => ({
          AttributeName,
          AttributeType: "S",
        })),
      }),
    );
  return { client, createTable };
}
