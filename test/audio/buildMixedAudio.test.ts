import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { buildMixedAudio } from "../../src/audio";
import {
  cleanupMeetingTempDir,
  ensureMeetingTempDir,
} from "../../src/services/tempFileService";
import type { MeetingData } from "../../src/types/meeting-data";

jest.mock("fluent-ffmpeg", () => {
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const ffmpegMock = jest.fn(() => {
    const handlers = new Map<string, () => void>();
    const chain = {
      inputOptions: jest.fn(() => chain),
      audioCodec: jest.fn(() => chain),
      outputOptions: jest.fn(() => chain),
      toFormat: jest.fn(() => chain),
      on: jest.fn((event: string, callback: () => void) => {
        handlers.set(event, callback);
        return chain;
      }),
      save: jest.fn((outputPath: string) => {
        fs.writeFileSync(outputPath, Buffer.alloc(8));
        handlers.get("end")?.();
        return chain;
      }),
    };
    return chain;
  });
  return { __esModule: true, default: ffmpegMock };
});

describe("buildMixedAudio", () => {
  test("encodes a single speaker track", async () => {
    const meeting = {
      meetingId: "meeting-1",
      audioData: {
        currentSnippets: new Map(),
        audioFiles: [],
        speakerTracks: new Map(),
      },
    } as MeetingData;

    const tempDir = await ensureMeetingTempDir(meeting);
    const trackDir = path.join(tempDir, "t");
    await fs.promises.mkdir(trackDir, { recursive: true });
    const trackPath = path.join(trackDir, "t_user-1.pcm");
    await fs.promises.writeFile(trackPath, Buffer.alloc(20));

    meeting.audioData.speakerTracks?.set("user-1", {
      userId: "user-1",
      filePath: trackPath,
      lastEndMs: 20,
      source: "voice",
    });

    try {
      const output = await buildMixedAudio(meeting);
      expect(output).toBe(path.join(tempDir, "recording_mixed.mp3"));
      expect(fs.existsSync(output!)).toBe(true);
      expect(jest.mocked(ffmpeg)).toHaveBeenCalledWith(trackPath);
    } finally {
      await cleanupMeetingTempDir(meeting);
    }
  });
});
