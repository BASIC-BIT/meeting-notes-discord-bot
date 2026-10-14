/** @jest-environment node */
jest.mock("../../src/services/ownedMeetingInterruption", () => ({
  interruptOwnedMeeting: jest.fn(async () => ({ kind: "unresolved" })),
}));
import { interruptOwnedMeeting } from "../../src/services/ownedMeetingInterruption";
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tempFiles from "../../src/services/tempFileService";
import * as checkpoints from "../../src/services/recordingCheckpointService";
import { checkpointRecordingContext } from "../../src/services/recordingContentService";
import { createMockDeploymentControlRepository } from "../../src/repositories/deploymentControlRepository";
import { history } from "../deployment/controlFixtures";
jest.mock("../../src/services/recordingContentService", () => ({
  startRecordingContentCheckpoint: jest.fn(),
  checkpointRecordingContext: jest.fn(),
  checkpointCompletedTranscription: jest.fn(),
}));
import { PassThrough, TransformCallback } from "node:stream";
import { VoiceConnectionStatus } from "@discordjs/voice";
import {
  subscribeToUserVoice,
  stopRecordingCapture,
  waitForCaptureStreamSettlement,
  userStartTalking,
  userStopTalking,
} from "../../src/audio";
import type { MeetingData } from "../../src/types/meeting-data";

const mockDecoders: PassThrough[] = [];
let mockBlockDecode = false;
const mockDecodeCallbacks: TransformCallback[] = [];

jest.mock("prism-media", () => {
  const { PassThrough: MockPassThrough } =
    jest.requireActual<typeof import("node:stream")>("node:stream");
  return {
    opus: {
      Decoder: class FakeDecoder extends MockPassThrough {
        constructor() {
          super();
          mockDecoders.push(this);
        }
        _transform(
          chunk: Buffer,
          _encoding: BufferEncoding,
          done: TransformCallback,
        ) {
          if (mockBlockDecode) mockDecodeCallbacks.push(done);
          else done(null, chunk);
        }
      },
    },
  };
});

function createMeeting(streams: PassThrough[]) {
  const receiver = {
    packetDiagnostics: new WeakMap(),
    subscriptions: new Map<string, PassThrough>(),
    subscribe: jest.fn((userId: string) => {
      const stream = new PassThrough({ objectMode: true });
      streams.push(stream);
      receiver.subscriptions.set(userId, stream);
      return stream;
    }),
  };
  const meeting = {
    meetingId: "meeting-1",
    chatLog: [],
    attendance: new Set<string>(),
    connection: {
      receiver,
      state: { status: VoiceConnectionStatus.Ready },
    },
    textChannel: {} as MeetingData["textChannel"],
    voiceChannel: {
      members: new Map([["user-1", {}]]),
    } as MeetingData["voiceChannel"],
    guildId: "guild-1",
    channelId: "channel-1",
    audioData: { currentSnippets: new Map(), audioFiles: [] },
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
  } as unknown as MeetingData;
  return { meeting, receiver };
}

describe("voice subscriptions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockDecoders.length = 0;
    mockBlockDecode = false;
    mockDecodeCallbacks.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });
  test("capture start is stamped at actual subscription and never replaces reservation time", async () => {
    const { meeting } = createMeeting([]);
    meeting.startTime = new Date(100);
    meeting.finishing = true;
    await subscribeToUserVoice(meeting, "user-1");
    expect(meeting.captureStartedAt).toBeUndefined();
    meeting.finishing = false;
    await subscribeToUserVoice(meeting, "user-1");
    const captured = meeting.captureStartedAt;
    expect(captured).toEqual(new Date());
    await jest.advanceTimersByTimeAsync(1_000);
    await subscribeToUserVoice(meeting, "user-1");
    expect(meeting.captureStartedAt).toBe(captured);
    expect(meeting.startTime.getTime()).toBe(100);
  });

  test("reports the failing queued input, not the most recently received packet", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    mockBlockDecode = true;
    try {
      await subscribeToUserVoice(meeting, "user-1");
      const first = Buffer.from([0xf8, 0xff, 0xfe]);
      const failing = Buffer.from([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 0xfa, 0xfa,
      ]);
      const later = Buffer.from([0xf8, 0xff, 0xfe]);
      receiver.packetDiagnostics.set(failing, {
        connectionStatus: "connecting",
        networkingCode: 5,
        daveSessionPresent: true,
        daveNativeSessionPresent: true,
        daveReady: false,
        daveProtocolVersion: 1,
        daveDecryptDecision: "not-ready",
        daveTransitionAgoMs: 164,
      });
      streams[0].write(first);
      streams[0].write(failing);
      streams[0].write(later);
      mockDecodeCallbacks.shift()!();
      mockDecodeCallbacks.shift()!(new Error("decoder failed"));
      await jest.advanceTimersByTimeAsync(0);
      const warning = warn.mock.calls.find(([message]) =>
        String(message).startsWith("Opus decoder error:"),
      )?.[0];
      expect(warning).toEqual(
        expect.stringContaining("opusPacketBytes=15 daveFooterCandidate=true"),
      );
      expect(warning).toEqual(
        expect.stringContaining("connectionStatus=connecting networkingCode=5"),
      );
      expect(warning).toEqual(
        expect.stringContaining(
          "daveReady=false daveProtocolVersion=1 daveDecryptDecision=not-ready daveTransitionAgoMs=164",
        ),
      );
      expect(meeting.audioData.captureIncomplete).toBe(true);
      expect(
        [...warn.mock.calls, ...log.mock.calls].every(
          ([message]) =>
            !String(message).includes("user-1") &&
            !String(message).includes("speaker="),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  test("resubscribes after opus stream error", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);

    await subscribeToUserVoice(meeting, "user-1");

    expect(receiver.subscribe).toHaveBeenCalledTimes(1);
    streams[0].emit("error", new Error("corrupt"));
    expect(meeting.audioData.captureIncomplete).toBe(true);
    jest.runOnlyPendingTimers();
    expect(receiver.subscribe).toHaveBeenCalledTimes(2);

    meeting.audioData.captureIncomplete = false;
    userStartTalking(meeting, "user-1");
    jest.advanceTimersByTime(800);
    userStopTalking(meeting, "user-1");
    expect(meeting.audioData.captureIncomplete).toBe(true);

    meeting.audioData.captureIncomplete = false;
    meeting.finishing = true;
    streams[1].emit("error", new Error("finishing"));
    expect(meeting.audioData.captureIncomplete).toBe(false);

    meeting.finishing = false;
    meeting.connection.state.status = VoiceConnectionStatus.Destroyed;
    streams[1].emit("error", new Error("destroyed"));
    expect(meeting.audioData.captureIncomplete).toBe(false);

    meeting.finishing = true;
    meeting.connection.state.status = VoiceConnectionStatus.Ready;
    userStartTalking(meeting, "user-1");
    jest.advanceTimersByTime(800);
    userStopTalking(meeting, "user-1");
    expect(meeting.audioData.captureIncomplete).toBe(false);

    meeting.finishing = false;
    meeting.connection.state.status = VoiceConnectionStatus.Destroyed;
    userStartTalking(meeting, "user-1");
    jest.advanceTimersByTime(800);
    userStopTalking(meeting, "user-1");
    expect(meeting.audioData.captureIncomplete).toBe(false);
  });

  test.each([
    [
      "marked",
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 0xfa, 0xfa]),
      true,
    ],
    [
      "unmarked",
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 0, 0]),
      false,
    ],
    ["too short", Buffer.from([12, 0xfa, 0xfa]), false],
    [
      "impossible size",
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 0xfa, 0xfa]),
      false,
    ],
  ])("logs only shape for %s packet", async (_name, packet, candidate) => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await subscribeToUserVoice(meeting, "user-1");
      mockBlockDecode = true;
      streams[0].write(packet);
      mockDecodeCallbacks.shift()!(new Error("decoder failed"));
      await jest.advanceTimersByTimeAsync(0);
      const warning = warn.mock.calls.find(([message]) =>
        String(message).startsWith("Opus decoder error:"),
      )?.[0];
      expect(warning).toEqual(
        expect.stringContaining(
          `opusPacketBytes=${packet.length} daveFooterCandidate=${candidate}`,
        ),
      );
      expect(warning).toEqual(
        expect.stringContaining("daveDecryptDecision=UNKNOWN"),
      );
      expect(warning).not.toEqual(expect.stringContaining("user-1"));
      expect(warning).not.toEqual(expect.stringContaining("speaker="));
      expect(
        warn.mock.calls.every(
          ([message]) => !String(message).includes("user-1"),
        ),
      ).toBe(true);
      expect(meeting.audioData.captureIncomplete).toBe(true);
      jest.runOnlyPendingTimers();
      expect(receiver.subscribe).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  test("reports UNKNOWN receiver state for an unattributed stream error", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await subscribeToUserVoice(meeting, "user-1");
      mockDecoders[0].emit("error", new Error("before packet"));
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "opusPacketBytes=none daveFooterCandidate=none",
        ),
      );
      expect(meeting.audioData.captureIncomplete).toBe(true);
      jest.runOnlyPendingTimers();
      expect(receiver.subscribe).toHaveBeenCalledTimes(2);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("daveTransitionAgoMs=UNKNOWN"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("actual capture preservation cutoff handoff", () => {
  test.each([true, false])(
    "notice failure cannot block stopped capture and confirmed=%s handoff",
    async (storageRecovers) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:02Z"));
      const directory = mkdtempSync(path.join(tmpdir(), "capture-cutoff-"));
      const temp = jest
        .spyOn(tempFiles, "ensureMeetingTempDirSync")
        .mockReturnValue(directory);
      const row = { ...history, status: "in_progress" as const };
      const repo = createMockDeploymentControlRepository(
        new Map(),
        new Map([[history.guildId, [row]]]),
        new Map([
          [
            history.guildId,
            {
              guildId: history.guildId,
              meetingId: history.meetingId,
              ownerInstanceId: "old",
              executionVersion: 1,
              voiceOperationAttemptId: "voice",
              sessionMode: "meeting",
              voiceChannelId: history.channelId,
              textChannelId: "text",
              isAutoRecording: false,
              leaseExpiresAt: Math.floor(Date.now() / 1000) + 120,
              createdAt: row.timestamp,
              updatedAt: row.timestamp,
              expiresAt: 0,
            },
          ],
        ]),
      );
      const objects = new Map<string, Buffer>();
      const service = checkpoints
        .createRecordingCheckpointService({
          repository: repo,
          objects: {
            upload: async (key, bytes) => {
              objects.set(key, Buffer.from(bytes));
              return key;
            },
            read: async (key) => objects.get(key),
          },
        })
        .createProducerSession();
      let attempts = 0;
      const append = jest
        .spyOn(checkpoints, "appendMeetingCheckpointArtifacts")
        .mockImplementation(async (meeting, artifacts, signal) => {
          if (++attempts <= 3 || !storageRecovers)
            return {
              kind: "preservation_failed",
              coverage: {
                kind: "unknown",
                reason: "verification_failed",
                detectedAt: new Date().toISOString(),
              },
            };
          return service.appendArtifactsRecordingCheckpoint(
            meeting,
            [...artifacts],
            signal,
          );
        });
      const streams: PassThrough[] = [];
      const { meeting, receiver } = createMeeting(streams);
      const owner = new AbortController();
      Object.assign(meeting, {
        guildId: history.guildId,
        channelId: history.channelId,
        meetingId: history.meetingId,
        ownershipSignal: owner.signal,
        textChannel: {
          send: jest.fn().mockRejectedValue(new Error("notice unavailable")),
        },
        reservation: {
          sessionMode: "meeting",
          guildId: history.guildId,
          meetingId: history.meetingId,
          ownerInstanceId: "old",
          executionVersion: 1,
          voiceOperationAttemptId: "voice",
          reservedAt: Date.parse(history.timestamp),
          historyKey: {
            guildId: history.guildId,
            channelId_timestamp: history.channelId_timestamp,
          },
          workHandle: { settle: jest.fn(), transition: jest.fn() },
        },
      });
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await subscribeToUserVoice(meeting, "user-1");
        streams[0].write(Buffer.alloc(3840));
        await jest.advanceTimersByTimeAsync(60000);
        await meeting.recordingPreservationTask;
        expect(interruptOwnedMeeting).toHaveBeenCalledWith(
          meeting,
          expect.objectContaining({ reason: "capture_failure" }),
        );
        expect(receiver.subscriptions.size).toBe(0);
        const subscriptionsBefore = receiver.subscribe.mock.calls.length;
        await subscribeToUserVoice(meeting, "user-1");
        expect(receiver.subscribe).toHaveBeenCalledTimes(subscriptionsBefore);
        expect(meeting.recordingPreservationFailure).toMatchObject({
          reason: "storage_preservation",
          preservation: storageRecovers ? "confirmed" : "unconfirmed",
        });
        expect(meeting.recordingCaptureState).toMatchObject({
          kind: "interrupted",
          endedAt: "2026-01-01T00:01:02.000Z",
        });
        expect(meeting.reservation?.workHandle.settle).not.toHaveBeenCalled();
        expect(owner.signal.aborted).toBe(false);
        expect(
          meeting.recordingCapture
            ?.pending()
            .every((item) => existsSync(item.file)),
        ).toBe(true);
        if (storageRecovers) {
          expect(
            (await service.read(row.checkpoint!)).manifest.captureState.kind,
          ).toBe("interrupted");
        } else expect(row.checkpoint).toBeUndefined();
        meeting.recordingCapture?.releaseSettledBuffers();
      } finally {
        temp.mockRestore();
        append.mockRestore();
        warn.mockRestore();
        rmSync(directory, { recursive: true, force: true });
        jest.useRealTimers();
      }
    },
  );
});

test("receiver PCM commit serializes its synchronous context checkpoint", async () => {
  jest.useFakeTimers();
  const directory = mkdtempSync(path.join(tmpdir(), "capture-reentrant-"));
  const temp = jest
    .spyOn(tempFiles, "ensureMeetingTempDirSync")
    .mockReturnValue(directory);
  const append = jest
    .spyOn(checkpoints, "appendMeetingCheckpointArtifacts")
    .mockResolvedValue({
      kind: "preservation_failed",
      coverage: {
        kind: "unknown",
        reason: "verification_failed",
        detectedAt: new Date().toISOString(),
      },
    });
  let sequence = 0;
  jest.mocked(checkpointRecordingContext).mockImplementation((meeting) => {
    meeting.recordingCapture!.queueContent({
      kind: "context",
      sourceId: "context",
      sequence: sequence++,
      bytes: Buffer.from("{}"),
      checksumSha256: "a".repeat(64),
      contentType: "application/json",
      coverage: { kind: "unknown" },
    });
  });
  const streams: PassThrough[] = [];
  const { meeting } = createMeeting(streams);
  Object.assign(meeting, {
    ownershipSignal: new AbortController().signal,
    reservation: { sessionMode: "meeting" },
  });
  try {
    await subscribeToUserVoice(meeting, "user-1");
    userStartTalking(meeting, "user-1");
    streams[0].write(Buffer.alloc(3840));
    await jest.advanceTimersByTimeAsync(30000);
    await meeting.recordingCapture!.settled();
    expect(append).toHaveBeenCalledTimes(1);
    expect(
      meeting.recordingCapture!.pending().map(({ artifact }) => artifact.kind),
    ).toEqual(["audio", "context"]);
  } finally {
    meeting.recordingCapture!.fence();
    await meeting.recordingCapture!.settled();
    meeting.recordingCapture!.releaseSettledBuffers();
    jest.mocked(checkpointRecordingContext).mockReset();
    temp.mockRestore();
    append.mockRestore();
    rmSync(directory, { recursive: true, force: true });
    jest.useRealTimers();
  }
});

test("capture teardown waits for actual receiver and decoder close after synchronous detachment", async () => {
  jest.useRealTimers();
  const streams: PassThrough[] = [];
  const { meeting, receiver } = createMeeting(streams);
  await subscribeToUserVoice(meeting, "user-1");
  let release!: () => void;
  jest.spyOn(streams[0], "_destroy").mockImplementation((_error, done) => {
    release = () => done(null);
  });
  stopRecordingCapture(meeting, "interrupted");
  expect(receiver.subscriptions.size).toBe(0);
  let settled = false;
  const drain = waitForCaptureStreamSettlement(meeting).then(() => {
    settled = true;
  });
  await new Promise<void>((done) => setImmediate(done));
  expect(settled).toBe(false);
  release();
  await drain;
  expect(streams[0].closed).toBe(true);
  expect(mockDecoders.at(-1)!.closed).toBe(true);
});

test("queued resubscribe cannot dispatch after synchronous capture fence", async () => {
  jest.useFakeTimers();
  const streams: PassThrough[] = [];
  const { meeting, receiver } = createMeeting(streams);
  const diagnostic = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await subscribeToUserVoice(meeting, "user-1");
    streams[0].emit("error", new Error("synthetic receiver failure"));
    expect(diagnostic).toHaveBeenCalled();
    stopRecordingCapture(meeting, "interrupted");
    await jest.advanceTimersByTimeAsync(1000);
    await waitForCaptureStreamSettlement(meeting);
    expect(receiver.subscribe).toHaveBeenCalledTimes(1);
  } finally {
    diagnostic.mockRestore();
    jest.useRealTimers();
  }
});
