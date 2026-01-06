import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { stitchAudioSegments } from "../../src/audio";
import {
  cleanupMeetingTempDir,
  ensureMeetingTempDir,
} from "../../src/services/tempFileService";
import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  RECORD_SAMPLE_RATE,
} from "../../src/constants";
import type { MeetingData } from "../../src/types/meeting-data";
import type { AudioSegmentFile } from "../../src/types/audio";

let capturedPcm: Buffer | undefined;

jest.mock("fluent-ffmpeg", () => {
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const ffmpegMock = jest.fn((inputPath: string) => {
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
        capturedPcm = fs.readFileSync(inputPath);
        fs.writeFileSync(outputPath, Buffer.alloc(10));
        handlers.get("end")?.();
        return chain;
      }),
    };
    return chain;
  });
  return { __esModule: true, default: ffmpegMock };
});

describe("stitchAudioSegments", () => {
  let meeting: MeetingData;
  let meetingDir: string;

  beforeEach(async () => {
    capturedPcm = undefined;
    meeting = {
      meetingId: `meeting-${Date.now()}`,
      chatLog: [],
      attendance: new Set<string>(),
      connection: {} as MeetingData["connection"],
      textChannel: {} as MeetingData["textChannel"],
      voiceChannel: {} as MeetingData["voiceChannel"],
      guildId: "guild-1",
      channelId: "channel-1",
      audioData: {
        currentSnippets: new Map(),
        audioFiles: [],
      },
      startTime: new Date(),
      creator: {} as MeetingData["creator"],
      guild: {} as MeetingData["guild"],
      finishing: false,
      isFinished: Promise.resolve(),
      setFinished: () => {},
      finished: false,
      transcribeMeeting: true,
      generateNotes: true,
      participants: new Map(),
      isAutoRecording: false,
    } as MeetingData;

    meetingDir = await ensureMeetingTempDir(meeting);
  });

  afterEach(async () => {
    await cleanupMeetingTempDir(meeting);
    jest.clearAllMocks();
  });

  it("stitches segments in order with silence gaps", async () => {
    const segmentDir = path.join(meetingDir, "s");
    await fs.promises.mkdir(segmentDir, { recursive: true });

    const firstData = Buffer.alloc(8, 0x11);
    const secondData = Buffer.alloc(8, 0x22);

    const firstPath = path.join(segmentDir, "s_1.pcm");
    const secondPath = path.join(segmentDir, "s_2.pcm");

    await fs.promises.writeFile(firstPath, firstData);
    await fs.promises.writeFile(secondPath, secondData);

    const segments: AudioSegmentFile[] = [
      {
        filePath: firstPath,
        offsetMs: 0,
        durationMs: 10,
        userId: "user-1",
      },
      {
        filePath: secondPath,
        offsetMs: 30,
        durationMs: 10,
        userId: "user-2",
      },
    ];

    meeting.audioData.audioSegments = segments;

    const result = await stitchAudioSegments(meeting);

    expect(jest.mocked(ffmpeg)).toHaveBeenCalledTimes(1);
    expect(result).toBe(path.join(meetingDir, "recording_stitched.mp3"));

    const expectedSilenceBytes =
      Math.floor((20 / 1000) * RECORD_SAMPLE_RATE) *
      CHANNELS *
      BYTES_PER_SAMPLE;

    expect(capturedPcm).toBeDefined();
    expect(capturedPcm!.length).toBe(
      firstData.length + expectedSilenceBytes + secondData.length,
    );

    expect(capturedPcm!.slice(0, firstData.length)).toEqual(firstData);
    const silenceSlice = capturedPcm!.slice(
      firstData.length,
      firstData.length + expectedSilenceBytes,
    );
    expect(silenceSlice.every((value) => value === 0)).toBe(true);
    expect(
      capturedPcm!.slice(
        firstData.length + expectedSilenceBytes,
        firstData.length + expectedSilenceBytes + secondData.length,
      ),
    ).toEqual(secondData);

    expect(fs.existsSync(path.join(meetingDir, "recording_stitched.pcm"))).toBe(
      false,
    );
  });
});
