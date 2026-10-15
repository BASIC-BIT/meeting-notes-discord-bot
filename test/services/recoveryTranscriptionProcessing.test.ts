/** @jest-environment node */
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
jest.mock("../../src/services/transcriptionService", () => ({
  ...jest.requireActual("../../src/services/transcriptionService"),
  transcribeContentSnippet: jest.fn(async () => ({
    status: "succeeded",
    text: "New verified interval.",
  })),
}));
import {
  getCheckpointPcmBudget,
  reserveCheckpointPcm,
  releaseCheckpointPcm,
} from "../../src/services/recordingCheckpointCapture";
import { transcribeContentSnippet } from "../../src/services/transcriptionService";
jest.mock("../../src/services/transcriptionFinalPassService", () => ({
  runContentTranscriptionFinalPass: jest.fn(async () => ({
    fallbackApplied: false,
  })),
}));
jest.mock("../../src/services/mixedPcmService", () => ({
  renderMixedPcmTracks: jest.fn(async (_tracks, output) => output),
}));
jest.mock("../../src/services/openaiClient", () => ({
  buildOpenAISafetyIdentifier: (id: string) => id,
  createOpenAIClient: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: "Original saved cleanup result." },
            },
          ],
        })),
      },
    },
  })),
}));
import { createHash } from "node:crypto";
import { recoveryFixture } from "./meetingRecoveryFixtures";
import {
  readRecoveryContent,
  recoverTranscript,
} from "../../src/services/meetingRecoveryContent";
import { liveTranscriptionProcessingSettings } from "../../src/services/transcriptionProcessingSettings";
import { runContentTranscriptionFinalPass } from "../../src/services/transcriptionFinalPassService";
import { renderMixedPcmTracks } from "../../src/services/mixedPcmService";
import { createOpenAIClient } from "../../src/services/openaiClient";
async function fixture(complete = false) {
  const f = await recoveryFixture();
  const signal = new AbortController().signal;
  const content = await readRecoveryContent(f.claim.history, f.reader, signal);
  if (content.context.settings.availability !== "available")
    throw new Error("settings");
  content.context.settings.value.processing = structuredClone(
    liveTranscriptionProcessingSettings,
  );
  content.context.settings.value.premiumTranscription = {
    enabled: true,
    cleanupEnabled: true,
  };
  content.context.settings.value.transcription.finalPassEnabled = true;
  content.context.context.transcriptionFormattedContext =
    "Frozen transcription context";
  content.context.context.transcriptionMaxContextLength = 1000;
  content.context.cleanupRoleNames = "Frozen role names";
  const prompt = {
    availability: "available" as const,
    value: {
      type: "chat" as const,
      name: "frozen-cleanup",
      version: 31,
      label: "original",
      template: [
        {
          role: "user" as const,
          content: "{{formattedContext}} {{roles}} {{transcription}}",
        },
      ],
    },
  };
  content.context.prompts.cleanup = prompt;
  content.context.prompts.finalPass = prompt;
  content.context.prompts.transcription = {
    availability: "available",
    value: {
      type: "text",
      name: "original-audio",
      version: 9,
      label: "original",
      template: "Original audio prompt",
    },
  };
  if (complete) {
    content.manifest.captureState = {
      kind: "complete",
      startedAt: f.claim.history.timestamp,
      endedAt: "2026-01-01T00:00:01Z",
    };
    const bytes = Buffer.alloc(192000);
    const object = {
      key: "generated-audio",
      byteLength: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    f.objects.set(object.key, bytes);
    content.verified.push({
      kind: "audio",
      sourceId: "user:123",
      sequence: 0,
      contentType: "audio/pcm",
      object,
      format: { encoding: "pcm_s16le", channels: 2, sampleRate: 48000 },
      coverage: {
        kind: "known",
        intervals: [
          { sourceId: "user:123", startOffsetMs: 0, durationMs: 1000 },
        ],
      },
    });
  }
  return { ...f, content, signal };
}
beforeEach(() => jest.clearAllMocks());
test("partial capture uses frozen cleanup and explicitly skips finalized-only stage", async () => {
  const f = await fixture();
  expect(
    await recoverTranscript(f.content, f.reader, f.signal, (run) => run()),
  ).toMatchObject({ text: "Original saved cleanup result." });
  expect(f.content.processing).toMatchObject({
    finalPass: "not_applicable",
    cleanup: "acknowledged",
  });
  expect(runContentTranscriptionFinalPass).not.toHaveBeenCalled();
  expect(createOpenAIClient).toHaveBeenCalledWith(
    expect.objectContaining({
      langfusePrompt: expect.objectContaining({ version: 31 }),
      userId: "123",
    }),
  );
});
test("complete verified PCM uses shared mixer and plain finalized-pass with frozen budgets", async () => {
  const f = await fixture(true);
  await recoverTranscript(f.content, f.reader, f.signal, (run) => run());
  expect(renderMixedPcmTracks).toHaveBeenCalledTimes(1);
  const input = jest.mocked(runContentTranscriptionFinalPass).mock.calls[0][0];
  expect(input).not.toHaveProperty("connection");
  expect(input.settings).toEqual(liveTranscriptionProcessingSettings.finalPass);
  expect(input.reconcileModel.model).toBe("original-model");
  expect(f.content.processing?.finalPass).toBe("acknowledged");
});
test("missing original processing inputs reconcile while a verified processed transcript needs no audio or provider", async () => {
  const f = await fixture();
  if (f.content.context.settings.availability !== "available")
    throw new Error("settings");
  delete f.content.context.settings.value.processing;
  await expect(
    recoverTranscript(f.content, f.reader, f.signal, (run) => run()),
  ).rejects.toThrow("Original cleanup");
  f.content.processing = {
    finalPass: "not_applicable",
    cleanup: "acknowledged",
    finalText: "Verified processed text",
  };
  expect(
    await recoverTranscript(f.content, f.reader, f.signal, (run) => run()),
  ).toMatchObject({ text: "Verified processed text" });
  expect(createOpenAIClient).not.toHaveBeenCalled();
});
test("known missing coverage never masquerades as a full finalized recording", async () => {
  const f = await fixture(true);
  f.content.context.captureIncomplete = true;
  await recoverTranscript(f.content, f.reader, f.signal, (run) => run());
  expect(runContentTranscriptionFinalPass).not.toHaveBeenCalled();
  expect(f.content.processing?.finalPass).toBe("not_applicable");
});

test("processed transcript without exact audio coverage cannot bypass newer PCM", async () => {
  const f = await fixture(true);
  f.content.processing = {
    finalPass: "acknowledged",
    cleanup: "disabled",
    finalText: "Previously acknowledged processed text.",
  };
  if (f.content.context.settings.availability !== "available")
    throw new Error("fixture");
  f.content.context.settings.value.premiumTranscription.enabled = false;
  const text = await recoverTranscript(f.content, f.reader, f.signal, (run) =>
    run(),
  );
  expect(text.text).toContain("Previously acknowledged processed text.");
  expect(text.text).toContain("New verified interval.");
  expect(transcribeContentSnippet).toHaveBeenCalledTimes(1);
});

function addIntervalAudio(
  f: Awaited<ReturnType<typeof fixture>>,
  intervals: { startOffsetMs: number; durationMs: number }[],
) {
  if (f.content.context.settings.availability !== "available")
    throw new Error("settings");
  f.content.context.settings.value.transcription.finalPassEnabled = false;
  f.content.context.settings.value.premiumTranscription.enabled = false;
  f.content.entries = [];
  const bytes = Buffer.concat(
    intervals.map((interval, index) =>
      Buffer.alloc(Math.round(interval.durationMs * 192), (index % 250) + 1),
    ),
  );
  const object = {
    key: "generated-intervals",
    byteLength: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  f.objects.set(object.key, bytes);
  const audio = {
    kind: "audio" as const,
    sourceId: "user:123",
    sequence: 0,
    contentType: "audio/pcm",
    object,
    format: { encoding: "pcm_s16le" as const, sampleRate: 48000, channels: 2 },
    coverage: {
      kind: "known" as const,
      intervals: intervals.map((interval) => ({
        sourceId: "user:123",
        ...interval,
      })),
    },
  };
  f.content.verified.push(audio);
  return audio;
}

test("1001 jittered packets use one accounted ASR chunk with exact source bytes and ephemeral gap silence", async () => {
  const f = await fixture();
  const intervals = Array.from({ length: 1001 }, (_, i) => ({
    startOffsetMs: i * 21,
    durationMs: 20,
  }));
  const audio = addIntervalAudio(f, intervals);
  const coverage = structuredClone(audio.coverage);
  jest
    .mocked(transcribeContentSnippet)
    .mockImplementationOnce(async (_input, snippet) => {
      const buffer = snippet.chunks[0];
      expect(buffer.length).toBe(21020 * 192);
      expect(getCheckpointPcmBudget().reservedBytes).toBe(buffer.length * 4);
      for (let i = 0; i < 1001; i++) {
        expect(buffer.subarray(i * 21 * 192, (i * 21 + 20) * 192)).toEqual(
          Buffer.alloc(3840, (i % 250) + 1),
        );
        if (i < 1000)
          expect(
            buffer.subarray((i * 21 + 20) * 192, (i + 1) * 21 * 192),
          ).toEqual(Buffer.alloc(192));
      }
      return { status: "succeeded", text: "Grouped real conversation." };
    });
  const result = await recoverTranscript(f.content, f.reader, f.signal, (run) =>
    run(),
  );
  expect(transcribeContentSnippet).toHaveBeenCalledTimes(1);
  expect(result.segments).toHaveLength(1);
  expect(audio.coverage).toEqual(coverage);
  expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
});

test("long intervals and long gaps split into at most 30s scratch with an exact final tail", async () => {
  const f = await fixture();
  addIntervalAudio(f, [
    { startOffsetMs: 0, durationMs: 31000 },
    { startOffsetMs: 90000, durationMs: 20 },
  ]);
  await recoverTranscript(f.content, f.reader, f.signal, (run) => run());
  const calls = jest.mocked(transcribeContentSnippet).mock.calls;
  expect(calls.map(([, snippet]) => snippet.chunks[0].length)).toEqual([
    30000 * 192,
    1000 * 192,
    20 * 192,
  ]);
  expect(
    calls.map(
      ([, snippet]) =>
        snippet.timestamp - Date.parse(f.claim.history.timestamp),
    ),
  ).toEqual([0, 30000, 90000]);
  expect(calls.at(-1)![1].chunks[0]).toEqual(Buffer.alloc(3840, 2));
  expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
});

test("scratch ownership remains charged until an aborted actual call settles", async () => {
  const f = await fixture();
  addIntervalAudio(f, [
    { startOffsetMs: 0, durationMs: 20 },
    { startOffsetMs: 90000, durationMs: 20 },
  ]);
  const controller = new AbortController();
  let settle!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  jest.mocked(transcribeContentSnippet).mockImplementationOnce(async () => {
    entered();
    await pending;
    return { status: "succeeded", text: "Owned operation settled." };
  });
  const work = recoverTranscript(
    f.content,
    f.reader,
    controller.signal,
    (run) => run(),
  );
  const rejection = expect(work).rejects.toThrow("stopped");
  await started;
  controller.abort(new Error("stopped"));
  expect(getCheckpointPcmBudget().reservedBytes).toBe(3840 * 4);
  settle();
  await rejection;
  expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
  expect(transcribeContentSnippet).toHaveBeenCalledTimes(1);
});

test("provider failure releases scratch and cannot start the later group", async () => {
  const f = await fixture();
  addIntervalAudio(f, [
    { startOffsetMs: 0, durationMs: 20 },
    { startOffsetMs: 90000, durationMs: 20 },
  ]);
  jest
    .mocked(transcribeContentSnippet)
    .mockRejectedValueOnce(new Error("provider failed"));
  await expect(
    recoverTranscript(f.content, f.reader, f.signal, (run) => run()),
  ).rejects.toThrow("provider failed");
  expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
  expect(transcribeContentSnippet).toHaveBeenCalledTimes(1);
});

test("an exhausted shared PCM budget refuses allocation and transcription", async () => {
  const f = await fixture();
  addIntervalAudio(f, [{ startOffsetMs: 0, durationMs: 20 }]);
  const bytes = getCheckpointPcmBudget().limitBytes / 4;
  expect(reserveCheckpointPcm(bytes)).toBe(true);
  try {
    await expect(
      recoverTranscript(f.content, f.reader, f.signal, (run) => run()),
    ).rejects.toThrow("budget unavailable");
    expect(transcribeContentSnippet).not.toHaveBeenCalled();
    expect(getCheckpointPcmBudget().reservedBytes).toBe(bytes * 4);
  } finally {
    releaseCheckpointPcm(bytes);
  }
  expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
});

test.each(["alignment", "bytes", "overlap"])(
  "invalid %s mapping refuses transcription without allocating scratch",
  async (kind) => {
    const f = await fixture();
    const audio = addIntervalAudio(f, [
      { startOffsetMs: 0, durationMs: 20 },
      { startOffsetMs: 21, durationMs: 20 },
    ]);
    if (kind === "alignment") audio.coverage.intervals[0].startOffsetMs = 0.001;
    if (kind === "bytes") audio.coverage.intervals[0].durationMs = 19;
    if (kind === "overlap") audio.coverage.intervals[1].startOffsetMs = 19;
    await expect(
      recoverTranscript(f.content, f.reader, f.signal, (run) => run()),
    ).rejects.toThrow("PCM");
    expect(transcribeContentSnippet).not.toHaveBeenCalled();
    expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
  },
);
