import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { buildLangfuseTranscriptionAudioAttachment } from "../../src/observability/langfuseAudioAttachment";

jest.mock("fluent-ffmpeg", () => {
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const ffmpegMock = jest.fn(() => {
    const handlers = new Map<string, () => void>();
    const chain = {
      audioCodec: jest.fn(() => chain),
      outputOptions: jest.fn(() => chain),
      toFormat: jest.fn(() => chain),
      on: jest.fn((event: string, callback: () => void) => {
        handlers.set(event, callback);
        return chain;
      }),
      save: jest.fn((outputPath: string) => {
        fs.writeFileSync(outputPath, Buffer.alloc(10));
        handlers.get("end")?.();
        return chain;
      }),
    };
    return chain;
  });
  return { __esModule: true, default: ffmpegMock };
});

describe("buildLangfuseTranscriptionAudioAttachment", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "langfuse-audio-"),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("returns an mp3 attachment when compression succeeds", async () => {
    const wavPath = path.join(tempDir, "snippet.wav");
    await fs.promises.writeFile(wavPath, Buffer.alloc(40));

    const result = await buildLangfuseTranscriptionAudioAttachment(wavPath, {
      maxBytes: 200,
    });

    expect(jest.mocked(ffmpeg)).toHaveBeenCalledTimes(1);
    expect(result?.contentType).toBe("audio/mpeg");
    expect(result?.byteLength).toBe(10);

    const mp3Path = path.join(tempDir, "snippet_langfuse.mp3");
    expect(fs.existsSync(mp3Path)).toBe(false);
  });

  it("returns undefined when the mp3 exceeds the size limit", async () => {
    const wavPath = path.join(tempDir, "snippet.wav");
    await fs.promises.writeFile(wavPath, Buffer.alloc(200));

    const result = await buildLangfuseTranscriptionAudioAttachment(wavPath, {
      maxBytes: 5,
    });

    expect(jest.mocked(ffmpeg)).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();

    const mp3Path = path.join(tempDir, "snippet_langfuse.mp3");
    expect(fs.existsSync(mp3Path)).toBe(false);
  });

  it("skips the attachment when compression fails", async () => {
    jest.mocked(ffmpeg).mockImplementationOnce(() => {
      const handlers = new Map<string, (error?: Error) => void>();
      const chain = {
        audioCodec: jest.fn(() => chain),
        outputOptions: jest.fn(() => chain),
        toFormat: jest.fn(() => chain),
        on: jest.fn((event: string, callback: (error?: Error) => void) => {
          handlers.set(event, callback);
          return chain;
        }),
        save: jest.fn(() => {
          handlers.get("error")?.(new Error("encode failed"));
          return chain;
        }),
      };
      return chain;
    });

    const wavPath = path.join(tempDir, "snippet.wav");
    await fs.promises.writeFile(wavPath, Buffer.alloc(200));

    const result = await buildLangfuseTranscriptionAudioAttachment(wavPath, {
      maxBytes: 50,
    });

    expect(jest.mocked(ffmpeg)).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();

    const mp3Path = path.join(tempDir, "snippet_langfuse.mp3");
    expect(fs.existsSync(mp3Path)).toBe(false);
  });
});
