import { LangfuseMedia } from "@langfuse/core";
import ffmpeg from "fluent-ffmpeg";
import { promises as fsPromises } from "node:fs";
import path from "node:path";

type LangfuseAudioContentType = "audio/wav" | "audio/mpeg";

export type LangfuseAudioAttachment = {
  media: LangfuseMedia;
  byteLength: number;
  contentType: LangfuseAudioContentType;
};

export type LangfuseAudioAttachmentOptions = {
  maxBytes?: number;
};

const LANGFUSE_AUDIO_MAX_BYTES_DEFAULT = 8_000_000;
const LANGFUSE_MP3_SAMPLE_RATE = 16000;
const LANGFUSE_MP3_CHANNELS = 1;
const LANGFUSE_MP3_VBR_QUALITY = 6;
const LANGFUSE_MP3_COMPRESSION_LEVEL = 2;
// TODO: Consider configurable compression settings for Langfuse media retention and cost.

function buildMp3PathFromWav(wavPath: string): string {
  const parsed = path.parse(wavPath);
  return path.join(parsed.dir, `${parsed.name}_langfuse.mp3`);
}

async function buildLangfuseAttachment(
  filePath: string,
  contentType: LangfuseAudioContentType,
): Promise<LangfuseAudioAttachment> {
  const audioBuffer = await fsPromises.readFile(filePath);
  return {
    media: new LangfuseMedia({
      source: "bytes",
      contentBytes: audioBuffer,
      contentType,
    }),
    byteLength: audioBuffer.length,
    contentType,
  };
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fsPromises.unlink(filePath);
  } catch {
    // Ignore cleanup failures for temp files.
  }
}

async function compressWavToMp3(
  wavPath: string,
  mp3Path: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(wavPath)
      .audioCodec("libmp3lame")
      .outputOptions([
        `-q:a ${LANGFUSE_MP3_VBR_QUALITY}`,
        `-compression_level ${LANGFUSE_MP3_COMPRESSION_LEVEL}`,
        `-ac ${LANGFUSE_MP3_CHANNELS}`,
        `-ar ${LANGFUSE_MP3_SAMPLE_RATE}`,
      ])
      .toFormat("mp3")
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(mp3Path);
  });
}

export async function buildLangfuseTranscriptionAudioAttachment(
  wavPath: string,
  options: LangfuseAudioAttachmentOptions = {},
): Promise<LangfuseAudioAttachment | undefined> {
  const maxBytes = options.maxBytes ?? LANGFUSE_AUDIO_MAX_BYTES_DEFAULT;
  try {
    const mp3Path = buildMp3PathFromWav(wavPath);
    try {
      await compressWavToMp3(wavPath, mp3Path);
      const mp3Stats = await fsPromises.stat(mp3Path);
      if (mp3Stats.size > maxBytes) {
        return undefined;
      }
      return await buildLangfuseAttachment(mp3Path, "audio/mpeg");
    } finally {
      await safeUnlink(mp3Path);
    }
  } catch (error) {
    console.warn("Failed to attach transcription audio to Langfuse.", error);
    return undefined;
  }
}
