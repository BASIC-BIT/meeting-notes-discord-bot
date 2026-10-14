/** @jest-environment node */
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { AudioPlayer } from "@discordjs/voice";
import type { MeetingData } from "../../src/types/meeting-data";
import { stopMeetingProcessing } from "../../src/services/meetingProcessingLifetime";
import { createTtsQueue } from "../../src/ttsQueue";
import { createCheckpointPlaybackTap } from "../../src/services/recordingCheckpointPlayback";
const mockSpeech = jest.fn();
const mockKill = jest.fn();
let mockHoldEncoder = false;
let mockResourceFailure = false;
const mockCommands: EventEmitter[] = [];
const mockOutput = () => {
  const stream = new PassThrough();
  setImmediate(() => stream.end(Buffer.alloc(3840)));
  return stream;
};
jest.mock("../../src/services/openaiClient", () => ({
  createOpenAIClient: () => ({
    audio: { speech: { create: (...args: unknown[]) => mockSpeech(...args) } },
  }),
}));
jest.mock("../../src/services/modelFactory", () => ({
  buildModelOverrides: jest.fn(),
  getModelChoice: () => ({ model: "generated" }),
}));
jest.mock("../../src/services/recordingContentService", () => ({
  checkpointCompletedTranscription: jest.fn(),
}));
jest.mock("../../src/services/recordingCheckpointPlayback", () => ({
  createCheckpointPlaybackTap: jest.fn(
    jest.requireActual("../../src/services/recordingCheckpointPlayback")
      .createCheckpointPlaybackTap,
  ),
}));
jest.mock("../../src/metrics", () => ({ chatTtsSpoken: { inc: jest.fn() } }));
jest.mock("fluent-ffmpeg", () => () => {
  const events = new (jest.requireActual("node:events").EventEmitter)();
  mockCommands.push(events);
  const chain = {
    inputOptions: () => chain,
    audioFrequency: () => chain,
    audioChannels: () => chain,
    format: () => chain,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      events.on(event, listener);
      return chain;
    },
    audioFilters: () => chain,
    pipe: () => {
      if (!mockHoldEncoder) setImmediate(() => events.emit("end"));
      return mockOutput();
    },
    kill: (signal: string) => {
      mockKill(signal);
      if (!mockHoldEncoder) setImmediate(() => events.emit("end"));
    },
  };
  return chain;
});
jest.mock("prism-media", () => {
  const stream = jest.requireActual("node:stream");
  return { opus: { Encoder: stream.PassThrough } };
});
jest.mock("@discordjs/voice", () => ({
  AudioPlayerStatus: { Idle: "idle" },
  StreamType: { Opus: "opus" },
  createAudioResource: (playStream: PassThrough) => {
    if (mockResourceFailure) throw new Error("synthetic resource failure");
    return {
      playStream,
      playbackDuration: 0,
      read: () => null,
    };
  },
}));
function fixture(recordBotAudio = false) {
  const player = Object.assign(new EventEmitter(), {
    state: { status: "idle" },
    play: jest.fn(() => setImmediate(() => player.emit("idle"))),
    stop: jest.fn(),
  });
  const meeting = {
    recordBotAudio,
    guild: { id: "generated" },
    voiceChannel: { id: "generated" },
    meetingId: "generated",
    audioData: { audioFiles: [] },
    ownershipSignal: new AbortController().signal,
  } as unknown as MeetingData;
  return {
    meeting,
    player,
    queue: createTtsQueue(meeting, player as unknown as AudioPlayer),
  };
}
const body = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(1920));
      c.close();
    },
  });
const item = {
  text: "Generated speech",
  userId: "generated",
  voice: "alloy",
  source: "chat_tts" as const,
};
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
beforeEach(() => {
  jest.clearAllMocks();
  mockHoldEncoder = false;
  mockResourceFailure = false;
  mockCommands.length = 0;
  mockSpeech.mockResolvedValue({ body: body() });
});
test("TTS-only playback does not reserve recording PCM or stop itself", async () => {
  const f = fixture();
  f.queue.enqueue(item);
  await settle();
  expect(f.player.play).toHaveBeenCalledTimes(1);
  expect(createCheckpointPlaybackTap).not.toHaveBeenCalled();
  expect(f.player.stop).not.toHaveBeenCalled();
  expect(f.meeting.audioData.audioFiles[0].transcript).toBe(item.text);
});
test("stopped generation cannot play after a held speech response arrives", async () => {
  let complete!: (response: { body: ReadableStream<Uint8Array> }) => void;
  mockSpeech.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const f = fixture();
  f.queue.enqueue(item);
  f.queue.stopAndClear();
  complete({ body: body() });
  await settle();
  expect(f.player.play).not.toHaveBeenCalled();
  expect(createCheckpointPlaybackTap).not.toHaveBeenCalled();
});
test("pre-play failure disposes capture tap and ffmpeg without playing", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const f = fixture(true);
    f.queue.enqueue({
      ...item,
      onBeforePlay: () => {
        throw new Error("generated preplay failure");
      },
    });
    await settle();
    expect(f.player.play).not.toHaveBeenCalled();
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
    expect(
      jest.mocked(createCheckpointPlaybackTap).mock.results[0].value.stream
        .destroyed,
    ).toBe(true);
  } finally {
    error.mockRestore();
  }
});

test("processing stop retains an issued TTS provider until its late body is cancelled", async () => {
  let complete!: (response: { body: ReadableStream<Uint8Array> }) => void;
  let cancelBody!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    cancelBody = resolve;
  });
  mockSpeech.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const f = fixture();
  f.queue.enqueue(item);
  let settled = false;
  const drain = stopMeetingProcessing(f.meeting).then(() => {
    settled = true;
  });
  f.queue.stopAndClear();
  await settle();
  expect(settled).toBe(false);
  const lateBody = new ReadableStream<Uint8Array>({ cancel: () => cancelled });
  complete({ body: lateBody });
  await settle();
  expect(settled).toBe(false);
  expect(f.player.play).not.toHaveBeenCalled();
  cancelBody();
  await drain;
  expect(settled).toBe(true);
});

test("TTS playback settlement requires actual ffmpeg termination after kill request", async () => {
  mockHoldEncoder = true;
  const f = fixture();
  f.queue.enqueue(item);
  await settle();
  expect(mockKill).toHaveBeenCalledWith("SIGTERM");
  let settled = false;
  const drain = stopMeetingProcessing(f.meeting).then(() => {
    settled = true;
  });
  await settle();
  expect(settled).toBe(false);
  mockCommands[0].emit("end");
  await drain;
  expect(settled).toBe(true);
});

test("resource construction failure retains the started encoder until actual termination", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    mockResourceFailure = true;
    mockHoldEncoder = true;
    const f = fixture();
    f.queue.enqueue(item);
    await settle();
    let stopped = false;
    const drain = stopMeetingProcessing(f.meeting).then(() => {
      stopped = true;
    });
    await settle();
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
    expect(stopped).toBe(false);
    mockCommands[0].emit("end");
    await drain;
    expect(f.player.play).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Failed to stream TTS to Discord:",
      expect.objectContaining({ message: "synthetic resource failure" }),
    );
  } finally {
    error.mockRestore();
  }
});
