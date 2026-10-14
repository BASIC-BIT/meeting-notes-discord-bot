/** @jest-environment node */
import fs from "node:fs";
import { Writable } from "node:stream";
import { maybeRespondLive } from "../../src/liveVoice";
jest.mock("dotenv", () => ({ config: jest.fn() }));
import { stopMeetingProcessing } from "../../src/services/meetingProcessingLifetime";
import type { MeetingData } from "../../src/types/meeting-data";
import type { AudioFileData, AudioSnippet } from "../../src/types/audio";
import { startProcessingSnippet, userStopTalking } from "../../src/audio";
import {
  coalesceTranscription,
  transcribeSnippet,
} from "../../src/services/transcriptionService";

jest.mock("../../src/liveVoice", () => ({
  maybeRespondLive: jest.fn(),
}));

jest.mock("../../src/services/transcriptionService", () => ({
  transcribeSnippet: jest.fn(),
  coalesceTranscription: jest.fn(),
  cleanupTranscription: jest.fn(),
}));

describe("startProcessingSnippet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const buildMeeting = (snippet: AudioSnippet, fileData: AudioFileData) =>
    ({
      guildId: "guild-1",
      channelId: "channel-1",
      meetingId: "meeting-1",
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      audioData: {
        currentSnippets: new Map([[snippet.userId, snippet]]),
        audioFiles: [fileData],
      },
      runtimeConfig: {
        transcription: {
          fastSilenceMs: 400,
          slowSilenceMs: 2000,
          minSnippetSeconds: 0.3,
          maxSnippetMs: 60000,
          suppressionEnabled: true,
          suppressionHardSilenceDbfs: -60,
          suppressionRateMaxSeconds: 3,
          suppressionRateMinWords: 4,
          suppressionRateMinSyllables: 8,
          suppressionRateMaxSyllablesPerSecond: 7,
          promptEchoEnabled: true,
          voteEnabled: true,
          fastFinalizationEnabled: true,
          interjectionEnabled: false,
          interjectionMinSpeakerSeconds: 0.3,
          noiseGate: {
            enabled: false,
            windowMs: 20,
            peakDbfs: -45,
            minActiveWindows: 2,
            minPeakAboveNoiseDb: 15,
            applyToFast: true,
            applyToSlow: true,
          },
          finalPassEnabled: false,
        },
        premiumTranscription: {
          enabled: false,
          cleanupEnabled: false,
          coalesceModel: "gpt-5-mini",
        },
        dictionary: {
          maxEntries: 0,
          maxCharsTranscription: 0,
          maxCharsContext: 0,
        },
      },
    }) as unknown as MeetingData;

  const waitForSnippetWork = async (
    meeting: MeetingData,
    fileData: AudioFileData,
  ) => {
    await fileData.processingPromise;
    await meeting.audioData.speakerTracks?.get(fileData.userId)?.writePromise;
  };

  it("skips slow transcription when fast covers the snippet", async () => {
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(10)],
      audioBytes: 10,
      fastRevision: 1,
      fastTranscribed: true,
      lastFastTranscriptBytes: 10,
    };
    const audioFileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice",
      processing: true,
      audioOnlyProcessing: false,
      fastTranscripts: [
        {
          revision: 1,
          text: "hello there",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    snippet.audioFileData = audioFileData;

    const meeting = buildMeeting(snippet, audioFileData);

    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);

    expect(transcribeSnippet).not.toHaveBeenCalled();
    expect(audioFileData.transcript).toBe("hello there");
    expect(meeting.audioData.currentSnippets.has(snippet.userId)).toBe(false);
  });

  it("records successful slow transcription when fast does not cover the snippet", async () => {
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(10)],
      audioBytes: 60000,
      fastRevision: 1,
      fastTranscribed: true,
      lastFastTranscriptBytes: 10,
    };
    const audioFileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice",
      processing: true,
      audioOnlyProcessing: false,
      fastTranscripts: [
        {
          revision: 1,
          text: "hello there",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    snippet.audioFileData = audioFileData;

    const meeting = buildMeeting(snippet, audioFileData);
    (transcribeSnippet as jest.Mock).mockResolvedValue({
      status: "succeeded",
      text: "slow text",
    });

    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);

    expect(transcribeSnippet).toHaveBeenCalledTimes(1);
    expect(audioFileData.transcript).toBe("slow text");
    expect(audioFileData.transcriptionFailed).toBe(false);
    expect(audioFileData.processing).toBe(false);
  });

  it("records one terminal slow transcription failure without placeholder text", async () => {
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(60_000)],
      audioBytes: 60_000,
    };
    const audioFileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice",
      processing: true,
      audioOnlyProcessing: false,
    };
    snippet.audioFileData = audioFileData;
    const meeting = buildMeeting(snippet, audioFileData);
    (transcribeSnippet as jest.Mock).mockResolvedValue({
      status: "failed",
      reason: "transcription_error",
    });

    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);

    expect(audioFileData.transcriptionFailed).toBe(true);
    expect(audioFileData.transcript ?? "").not.toContain(
      "[Transcription failed]",
    );
    expect(audioFileData.processing).toBe(false);
  });

  it("treats a successful empty slow response as resolved work", async () => {
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(60_000)],
      audioBytes: 60_000,
    };
    const audioFileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice",
      processing: true,
      audioOnlyProcessing: false,
      transcriptionFailed: true,
    };
    snippet.audioFileData = audioFileData;
    const meeting = buildMeeting(snippet, audioFileData);
    (transcribeSnippet as jest.Mock).mockResolvedValue({
      status: "succeeded",
      text: "",
    });

    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);

    expect(audioFileData.slowTranscript).toBe("");
    expect(audioFileData.transcriptionFailed).toBe(false);
  });

  it("ignores a stale fast revision after slow transcription succeeds", async () => {
    jest.useFakeTimers();
    let resolveFast!: (value: { status: "succeeded"; text: string }) => void;
    const fastResult = new Promise<{ status: "succeeded"; text: string }>(
      (resolve) => {
        resolveFast = resolve;
      },
    );
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(60_000)],
      audioBytes: 60_000,
    };
    const audioFileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice",
      processing: true,
      audioOnlyProcessing: false,
    };
    snippet.audioFileData = audioFileData;
    const meeting = buildMeeting(snippet, audioFileData);
    (transcribeSnippet as jest.Mock)
      .mockReturnValueOnce(fastResult)
      .mockResolvedValueOnce({ status: "succeeded", text: "slow complete" });

    userStopTalking(meeting, snippet.userId);
    jest.advanceTimersByTime(400);
    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);
    resolveFast({ status: "succeeded", text: "stale prefix" });
    await Promise.resolve();

    expect(audioFileData.transcript).toBe("slow complete");
    expect(audioFileData.fastTranscripts).toBeUndefined();
    jest.useRealTimers();
  });

  it("retains a partial fast prefix when the required slow pass fails", async () => {
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(60_000)],
      audioBytes: 60_000,
      lastFastTranscriptBytes: 10,
    };
    const audioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice" as const,
      processing: true,
      audioOnlyProcessing: false,
      transcript: "usable prefix",
      fastTranscripts: [
        {
          revision: 1,
          text: "usable prefix",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    snippet.audioFileData = audioFileData;
    const meeting = buildMeeting(snippet, audioFileData);
    (transcribeSnippet as jest.Mock).mockResolvedValue({
      status: "failed",
      reason: "transcription_error",
    });

    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);

    expect(audioFileData.transcript).toBe("usable prefix");
    expect(audioFileData.transcriptionFailed).toBe(true);
  });

  it("retains successful slow text when optional coalescing fails", async () => {
    const snippet: AudioSnippet = {
      userId: "user-1",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(60_000)],
      audioBytes: 60_000,
    };
    const audioFileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      source: "voice",
      processing: true,
      audioOnlyProcessing: false,
      fastTranscripts: [
        {
          revision: 1,
          text: "fast draft",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    snippet.audioFileData = audioFileData;
    const meeting = buildMeeting(snippet, audioFileData);
    meeting.runtimeConfig!.premiumTranscription.enabled = true;
    (transcribeSnippet as jest.Mock).mockResolvedValue({
      status: "succeeded",
      text: "slow baseline",
    });
    (coalesceTranscription as jest.Mock).mockRejectedValue(
      new Error("optional refinement failed"),
    );
    const diagnostic = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    startProcessingSnippet(meeting, snippet.userId);
    await waitForSnippetWork(meeting, audioFileData);

    expect(audioFileData.transcript).toBe("slow baseline");
    expect(audioFileData.transcriptionFailed).toBe(false);
    expect(audioFileData.coalescedTranscript).toBeUndefined();
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("coalesc"),
      expect.any(Error),
    );
    diagnostic.mockRestore();
  });
  it("retains an issued slow provider and refuses its late transcript after processing stop", async () => {
    const snippet: AudioSnippet = {
      userId: "synthetic",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(10)],
      audioBytes: 60000,
    };
    const fileData: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      processing: false,
      audioOnlyProcessing: false,
    };
    snippet.audioFileData = fileData;
    const meeting = buildMeeting(snippet, fileData);
    let finish!: (value: { status: "succeeded"; text: string }) => void;
    jest.mocked(transcribeSnippet).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    startProcessingSnippet(meeting, snippet.userId);
    let settled = false;
    const drain = stopMeetingProcessing(meeting).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish({ status: "succeeded", text: "late synthetic text" });
    await drain;
    expect(fileData.transcript).toBeUndefined();
  });

  it.each([false, true])(
    "speaker-track ownership waits for actual close, including a preceding error: %s",
    async (failBeforeClose) => {
      const diagnostic = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const snippet: AudioSnippet = {
        userId: "held-close",
        timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
        chunks: [Buffer.alloc(60000)],
        audioBytes: 60000,
      };
      const file: AudioFileData = {
        userId: snippet.userId,
        timestamp: snippet.timestamp,
        processing: false,
        audioOnlyProcessing: false,
      };
      snippet.audioFileData = file;
      const meeting = buildMeeting(snippet, file);
      let close!: () => void;
      const stream = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
        destroy(_error, done) {
          close = () => done();
        },
      });
      const mkdir = jest
        .spyOn(fs.promises, "mkdir")
        .mockResolvedValue(undefined);
      const output = jest
        .spyOn(fs, "createWriteStream")
        .mockReturnValue(stream as fs.WriteStream);
      jest
        .mocked(transcribeSnippet)
        .mockResolvedValueOnce({ status: "succeeded", text: "" });
      startProcessingSnippet(meeting, snippet.userId);
      for (let i = 0; i < 20; i++)
        await new Promise((done) => setImmediate(done));
      expect(stream.writableFinished).toBe(true);
      expect(stream.closed).toBe(false);
      if (failBeforeClose)
        stream.emit("error", new Error("synthetic late file failure"));
      let settled = false;
      const drain = stopMeetingProcessing(meeting).then(() => {
        settled = true;
      });
      for (let i = 0; i < 10; i++)
        await new Promise((done) => setImmediate(done));
      expect(settled).toBe(false);
      close();
      await drain;
      expect(stream.closed).toBe(true);
      if (failBeforeClose)
        expect(diagnostic).toHaveBeenCalledWith(
          expect.stringContaining("Failed to persist speaker track"),
          expect.any(Error),
        );
      diagnostic.mockRestore();
      mkdir.mockRestore();
      output.mockRestore();
    },
  );

  it("fast transcription retains its separately dispatched live response", async () => {
    jest.useFakeTimers();
    const snippet: AudioSnippet = {
      userId: "held-live",
      timestamp: new Date("2025-01-01T00:00:01.000Z").getTime(),
      chunks: [Buffer.alloc(60000)],
      audioBytes: 60000,
    };
    const file: AudioFileData = {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      processing: false,
      audioOnlyProcessing: false,
    };
    snippet.audioFileData = file;
    const meeting = buildMeeting(snippet, file);
    let release!: () => void;
    jest.mocked(maybeRespondLive).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    jest.mocked(transcribeSnippet).mockResolvedValueOnce({
      status: "succeeded",
      text: "synthetic live request",
    });
    userStopTalking(meeting, snippet.userId);
    await jest.advanceTimersByTimeAsync(400);
    expect(maybeRespondLive).toHaveBeenCalledTimes(1);
    let settled = false;
    const drain = stopMeetingProcessing(meeting).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await drain;
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
