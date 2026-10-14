/** @jest-environment node */
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
jest.mock("../../src/services/transcriptionService", () => ({
  ...jest.requireActual("../../src/services/transcriptionService"),
  transcribeContentSnippet: jest.fn(async () => ({
    status: "succeeded",
    text: "New verified interval.",
  })),
}));
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
  ).toBe("Original saved cleanup result.");
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
  ).toBe("Verified processed text");
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
  expect(text).toContain("Previously acknowledged processed text.");
  expect(text).toContain("New verified interval.");
  expect(transcribeContentSnippet).toHaveBeenCalledTimes(1);
});
