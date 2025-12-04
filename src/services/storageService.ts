import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./configService";

const s3Client = new S3Client({
  region: config.storage.awsRegion,
  endpoint: config.storage.endpoint,
  forcePathStyle: config.storage.forcePathStyle,
});

export interface TranscriptUploadInput {
  guildId: string;
  channelId: string;
  timestamp: string; // ISO string
  transcript: string;
}

export function buildTranscriptKey({
  guildId,
  channelId,
  timestamp,
}: TranscriptUploadInput): string {
  const safeTimestamp = timestamp.replace(/[:]/g, "-");
  const prefix = config.storage.transcriptPrefix
    ? config.storage.transcriptPrefix.replace(/\/?$/, "/")
    : "";
  return `${prefix}${guildId}/${channelId}-${safeTimestamp}.txt`;
}

export async function uploadTranscriptToS3(
  input: TranscriptUploadInput,
): Promise<string | undefined> {
  const Key = buildTranscriptKey(input);
  return uploadObjectToS3(Key, input.transcript, "text/plain; charset=utf-8");
}

export async function uploadObjectToS3(
  key: string,
  body: string | Uint8Array | Buffer,
  contentType: string,
): Promise<string | undefined> {
  if (!config.storage.transcriptBucket) {
    console.warn("TRANSCRIPTS_BUCKET not set; skipping upload to S3.");
    return undefined;
  }

  try {
    const contentLength =
      typeof body === "string"
        ? Buffer.byteLength(body)
        : Buffer.isBuffer(body)
          ? body.byteLength
          : body.length;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.storage.transcriptBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
    );
    return key;
  } catch (error) {
    console.error("Failed to upload object to S3", error);
    return undefined;
  }
}

export async function fetchTranscriptFromS3(
  key: string,
): Promise<string | undefined> {
  if (!config.storage.transcriptBucket) {
    console.warn(
      "TRANSCRIPTS_BUCKET not set; cannot fetch transcript from S3.",
    );
    return undefined;
  }

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.storage.transcriptBucket,
        Key: key,
      }),
    );

    const body = response.Body;
    if (!body) return undefined;

    return await body.transformToString();
  } catch (error) {
    console.error("Failed to fetch transcript from S3", error);
  }

  return undefined;
}
