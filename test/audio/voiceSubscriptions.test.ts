import { PassThrough, TransformCallback } from "node:stream";
import { VoiceConnectionStatus } from "@discordjs/voice";
import {
  subscribeToUserVoice,
  unsubscribeToVoiceUponLeaving,
  userStartTalking,
  userStopTalking,
} from "../../src/audio";
import type { MeetingData } from "../../src/types/meeting-data";

const mockDecoders: PassThrough[] = [];
let mockBlockDecode = false;
let mockFailDecoderConstruction = false;
const mockDecodeCallbacks: TransformCallback[] = [];

jest.mock("prism-media", () => {
  const { PassThrough: MockPassThrough } =
    jest.requireActual<typeof import("node:stream")>("node:stream");
  return {
    opus: {
      Decoder: class FakeDecoder extends MockPassThrough {
        constructor() {
          super();
          if (mockFailDecoderConstruction)
            throw new Error("private decoder detail");
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
  } as MeetingData;
  return { meeting, receiver };
}

describe("voice subscriptions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockDecoders.length = 0;
    mockBlockDecode = false;
    mockFailDecoderConstruction = false;
    mockDecodeCallbacks.length = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test.each(["receiver", "decoder", "pipe"])(
    "cleans up a failed awaited %s construction and preserves the rejection",
    async (stage) => {
      const streams: PassThrough[] = [];
      const { meeting, receiver } = createMeeting(streams);
      const failure = new Error("private construction detail");
      if (stage === "receiver")
        receiver.subscribe.mockImplementationOnce(() => {
          throw failure;
        });
      if (stage === "decoder") mockFailDecoderConstruction = true;
      if (stage === "pipe") {
        const subscribe = receiver.subscribe.getMockImplementation()!;
        receiver.subscribe.mockImplementationOnce((userId) => {
          const stream = subscribe(userId);
          jest.spyOn(stream, "pipe").mockImplementation(() => {
            throw failure;
          });
          return stream;
        });
      }

      await expect(subscribeToUserVoice(meeting, "user-1")).rejects.toThrow();
      await jest.advanceTimersByTimeAsync(0);

      expect(meeting.audioData.captureIncomplete).toBe(true);
      expect(streams.every((stream) => stream.destroyed)).toBe(true);
      expect(mockDecoders.every((stream) => stream.destroyed)).toBe(true);
      expect(receiver.subscriptions.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  test.each(["receiver", "decoder", "pipe"])(
    "contains a timer %s construction failure once without another retry",
    async (stage) => {
      const streams: PassThrough[] = [];
      const { meeting, receiver } = createMeeting(streams);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      await subscribeToUserVoice(meeting, "user-1");
      streams[0].emit("error", new Error("trigger"));
      if (stage === "receiver")
        receiver.subscribe.mockImplementationOnce(() => {
          throw new Error("private receiver detail");
        });
      if (stage === "decoder") mockFailDecoderConstruction = true;
      if (stage === "pipe") {
        const subscribe = receiver.subscribe.getMockImplementation()!;
        receiver.subscribe.mockImplementationOnce((userId) => {
          const stream = subscribe(userId);
          jest.spyOn(stream, "pipe").mockImplementation(() => {
            throw new Error("private pipe detail");
          });
          return stream;
        });
      }
      await jest.advanceTimersByTimeAsync(249);
      expect(receiver.subscribe).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await jest.advanceTimersByTimeAsync(5_000);

      expect(receiver.subscribe).toHaveBeenCalledTimes(2);
      expect(receiver.subscriptions.size).toBe(0);
      expect(streams.every((stream) => stream.destroyed)).toBe(true);
      expect(mockDecoders.every((stream) => stream.destroyed)).toBe(true);
      expect(meeting.audioData.captureIncomplete).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      const markers = warn.mock.calls.filter(([message]) =>
        String(message).startsWith("Voice subscription replacement failed:"),
      );
      expect(markers).toEqual([
        [
          "Voice subscription replacement failed:",
          { meetingId: "meeting-1", stage: "resubscribe" },
        ],
      ]);
    },
  );

  test.each(["departure", "finishing", "destroyed", "replacement"])(
    "ignores a queued recovery timer after %s",
    async (staleReason) => {
      const streams: PassThrough[] = [];
      const { meeting, receiver } = createMeeting(streams);
      const timeout = jest.spyOn(globalThis, "setTimeout");
      await subscribeToUserVoice(meeting, "user-1");
      streams[0].emit("error", new Error("trigger"));
      const queued = timeout.mock.calls.find(([, delay]) => delay === 250)?.[0];
      expect(typeof queued).toBe("function");
      if (staleReason === "departure")
        meeting.voiceChannel.members.delete("user-1");
      if (staleReason === "finishing") meeting.finishing = true;
      if (staleReason === "destroyed")
        meeting.connection.state.status = VoiceConnectionStatus.Destroyed;
      if (staleReason === "replacement")
        await subscribeToUserVoice(meeting, "user-1");
      const current = receiver.subscriptions.get("user-1");
      if (typeof queued === "function") queued();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(receiver.subscribe).toHaveBeenCalledTimes(
        staleReason === "replacement" ? 2 : 1,
      );
      expect(receiver.subscriptions.get("user-1")).toBe(current);
      expect(current?.destroyed).toBe(false);
      unsubscribeToVoiceUponLeaving(meeting, "user-1");
    },
  );

  test("a failed old timer stays silent when a newer subscription replaces it before rejection handling", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const timeout = jest.spyOn(globalThis, "setTimeout");
    await subscribeToUserVoice(meeting, "user-1");
    streams[0].emit("error", new Error("trigger"));
    const queued = timeout.mock.calls.find(([, delay]) => delay === 250)?.[0];
    receiver.subscribe.mockImplementationOnce(() => {
      throw new Error("old private failure");
    });
    if (typeof queued !== "function") throw new Error("Missing recovery timer");
    queued();
    await subscribeToUserVoice(meeting, "user-1");
    await jest.advanceTimersByTimeAsync(0);

    expect(receiver.subscriptions.get("user-1")).toBe(streams[1]);
    expect(streams[1].destroyed).toBe(false);
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith("Voice subscription replacement failed:"),
      ),
    ).toHaveLength(0);
    expect(meeting.audioData.captureIncomplete).toBe(true);
    unsubscribeToVoiceUponLeaving(meeting, "user-1");
  });

  test("a failed old pipe cleans only its own streams after a replacement takes ownership", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    const subscribe = receiver.subscribe.getMockImplementation()!;
    receiver.subscribe.mockImplementationOnce((userId) => {
      const stream = subscribe(userId);
      jest.spyOn(stream, "pipe").mockImplementation(() => {
        void subscribeToUserVoice(meeting, "user-1");
        throw new Error("old private pipe failure");
      });
      return stream;
    });
    await expect(subscribeToUserVoice(meeting, "user-1")).rejects.toThrow(
      "old private pipe failure",
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(streams[0].destroyed).toBe(true);
    expect(mockDecoders[0].destroyed).toBe(true);
    expect(receiver.subscriptions.get("user-1")).toBe(streams[1]);
    expect(streams[1].destroyed).toBe(false);
    expect(mockDecoders[1].destroyed).toBe(false);
    expect(meeting.audioData.captureIncomplete).toBeUndefined();
    unsubscribeToVoiceUponLeaving(meeting, "user-1");
  });

  test("disposes each distinct stream once and preserves external listeners", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    await subscribeToUserVoice(meeting, "user-1");
    const opus = streams[0];
    const decoder = mockDecoders[0];
    const opusDestroy = jest.spyOn(opus, "destroy");
    const decoderDestroy = jest.spyOn(decoder, "destroy");
    const externalEnd = jest.fn();
    const externalData = jest.fn();
    opus.on("end", externalEnd);
    decoder.on("data", externalData);

    unsubscribeToVoiceUponLeaving(meeting, "user-1");
    unsubscribeToVoiceUponLeaving(meeting, "user-1");

    expect(opusDestroy).toHaveBeenCalledTimes(1);
    expect(decoderDestroy).toHaveBeenCalledTimes(1);
    expect(opus.listeners("end")).toContain(externalEnd);
    expect(decoder.listeners("data")).toContain(externalData);
    expect(receiver.subscriptions.has("user-1")).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("retains a receiver replacement when the old subscription is cleared", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    await subscribeToUserVoice(meeting, "user-1");
    const replacement = new PassThrough();
    receiver.subscriptions.set("user-1", replacement);

    unsubscribeToVoiceUponLeaving(meeting, "user-1");

    expect(receiver.subscriptions.get("user-1")).toBe(replacement);
    expect(replacement.destroyed).toBe(false);
    replacement.destroy();
  });

  test("cancels recovery and ignores already queued PCM, end and error callbacks", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    const output = new PassThrough();
    meeting.audioData.audioPassThrough = output;
    const write = jest.spyOn(output, "write");
    await subscribeToUserVoice(meeting, "user-1");
    const stalePcmCallbacks = mockDecoders[0].listeners("data");
    const staleEndCallbacks = streams[0].listeners("end");
    const staleErrorCallbacks = mockDecoders[0].listeners("error");
    streams[0].emit("error", new Error("synthetic recovery trigger"));
    expect(jest.getTimerCount()).toBe(1);

    unsubscribeToVoiceUponLeaving(meeting, "user-1");
    for (const callback of stalePcmCallbacks) callback(Buffer.alloc(8));
    for (const callback of staleEndCallbacks) callback();
    for (const callback of staleErrorCallbacks)
      callback(new Error("synthetic late error"));
    await jest.advanceTimersByTimeAsync(1_000);

    expect(write).not.toHaveBeenCalled();
    expect(meeting.audioData.currentSnippets.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(receiver.subscribe).toHaveBeenCalledTimes(1);
    expect(meeting.audioData.captureIncomplete).toBe(true);
    output.destroy();
  });

  test("returns streams and recovery timers to baseline across repeated disposal", async () => {
    const streams: PassThrough[] = [];
    const { meeting, receiver } = createMeeting(streams);
    for (let cycle = 0; cycle < 20; cycle += 1) {
      await subscribeToUserVoice(meeting, "user-1");
      streams[cycle].emit("error", new Error("synthetic recovery trigger"));
      unsubscribeToVoiceUponLeaving(meeting, "user-1");
      await jest.advanceTimersByTimeAsync(0);
      expect(receiver.subscriptions.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      expect(streams[cycle].destroyed).toBe(true);
      expect(mockDecoders[cycle].destroyed).toBe(true);
      expect(streams[cycle].listenerCount("error")).toBe(0);
      expect(mockDecoders[cycle].listenerCount("error")).toBe(0);
    }
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
