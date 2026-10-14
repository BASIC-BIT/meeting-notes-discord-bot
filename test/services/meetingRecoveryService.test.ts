/** @jest-environment node */
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
jest.mock("../../src/services/transcriptionService", () => ({
  ...jest.requireActual("../../src/services/transcriptionService"),
  transcribeContentSnippet: jest.fn(async () => ({
    status: "succeeded",
    text: "Later verified discussion.",
  })),
}));
import { transcribeContentSnippet } from "../../src/services/transcriptionService";
import { createHash } from "node:crypto";
import { liveTranscriptionProcessingSettings } from "../../src/services/transcriptionProcessingSettings";
const mockCompletionBodies: unknown[] = [];
jest.mock("../../src/services/openaiClient", () => ({
  buildOpenAISafetyIdentifier: (id: string) => `safety:${id}`,
  createOpenAIClient: jest.fn((options: { traceName?: string }) => ({
    chat: {
      completions: {
        create: jest.fn(async (body: unknown) => {
          mockCompletionBodies.push(body);
          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content:
                    options.traceName === "meeting-summary"
                      ? JSON.stringify({
                          summarySentence:
                            "Release testing will finish tomorrow.",
                          summaryLabel: "Release Testing",
                        })
                      : "Saved decision <@123> <@&456> <@999>.",
                },
              },
            ],
          };
        }),
      },
    },
  })),
}));
import {
  recoverMeeting,
  type RecoveryDependencies,
} from "../../src/services/meetingRecoveryService";
import {
  recoverTranscript,
  readRecoveryContent,
} from "../../src/services/meetingRecoveryContent";
import {
  ensureMeetingNotes,
  ensureMeetingSummaries,
} from "../../src/services/meetingNotesService";
import { createOpenAIClient } from "../../src/services/openaiClient";
import { recoveryFixture } from "./meetingRecoveryFixtures";
async function fixture(
  text?: string,
  options?: Parameters<typeof recoveryFixture>[1],
) {
  const f = await recoveryFixture(text, options);
  let messages = 0;
  const send = jest.fn(async () => ({ id: `message-${++messages}` }));
  const notes = jest.fn(ensureMeetingNotes);
  const autoExport = jest.fn(async () => {});
  const deps: RecoveryDependencies = {
    repository: f.repository,
    reader: f.reader,
    signal: new AbortController().signal,
    now: () => f.now,
    effect: (run) => run(),
    notes,
    summaries: ensureMeetingSummaries,
    transcript: recoverTranscript,
    upload: f.upload,
    send,
    autoExport,
  };
  return { ...f, deps, send, notes, autoExport };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCompletionBodies.length = 0;
});
test("notesDisabledRemainDisabled", async () => {
  const f = await fixture(undefined, {
    requested: { transcribeMeeting: true, generateNotes: false },
  });
  await recoverMeeting(f.claim, f.deps);
  expect(f.autoExport).not.toHaveBeenCalled();
  expect(f.notes).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.claim.history.notes).toBeUndefined();
  expect(f.claim.history.processing?.notes).toBe("skipped");
});
test("partialSpeechGeneratesNotesWithoutVoiceJoin and verifiedTranscriptRecoversWithoutAudio", async () => {
  const f = await fixture();
  await readRecoveryContent(f.claim.history, f.reader, f.deps.signal);
  await recoverMeeting(f.claim, f.deps);
  expect(f.autoExport).toHaveBeenCalledWith(f.claim.history, f.deps.signal);
  expect(f.claim.history.status).toBe("interrupted");
  expect(f.claim.history.recovery).toMatchObject({
    disposition: "done",
    outcome: "completed",
  });
  expect(f.claim.history.notes).toContain("<@123>");
  expect(f.claim.history.notes).not.toContain("<@999>");
  expect(f.claim.history.checkpoint?.capture.ownerInstanceId).toBe("old");
  expect(f.claim.lease).not.toHaveProperty("voiceOperationAttemptId");
  expect(f.send).toHaveBeenCalledTimes(2);
  for (const call of f.send.mock.calls)
    expect(JSON.stringify(call)).toContain(
      "Partial notes: recording was interrupted.",
    );
  const input = f.notes.mock.calls[0][0];
  expect(input).not.toHaveProperty("connection");
  expect(input.captureNotice).toContain("ended abruptly");
  expect(input.captureNotice).toContain("cause is unknown");
  expect(input.captureNotice).toContain("never invent");
  expect(mockCompletionBodies).toHaveLength(2);
  for (const body of mockCompletionBodies) {
    expect(JSON.stringify(body)).toContain("ended abruptly");
    expect(JSON.stringify(body)).toContain("never invent");
  }
  expect(input.savedSummary?.prompt.version).toBe(12);
  expect(input.frozenModels?.notes.model).toBe("original-model");
  expect(createOpenAIClient).toHaveBeenCalledWith(
    expect.objectContaining({
      langfusePrompt: expect.objectContaining({ version: 12 }),
    }),
  );
});
test("noUsableSpeechSkipsNotes", async () => {
  const f = await fixture("");
  await recoverMeeting(f.claim, f.deps);
  expect(f.autoExport).not.toHaveBeenCalled();
  expect(f.notes).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.claim.history.recovery).toMatchObject({
    disposition: "done",
    outcome: "no_usable_speech",
  });
});
test("uncertainDeliveryIsNotResent", async () => {
  const f = await fixture();
  f.send.mockRejectedValueOnce(new Error("lost ACK"));
  await expect(recoverMeeting(f.claim, f.deps)).rejects.toThrow(
    "acknowledgment is unknown",
  );
  expect(f.claim.history.recovery).toMatchObject({
    disposition: "needs_reconciliation",
    reason: "delivery_uncertain",
  });
  await recoverMeeting(f.claim, f.deps);
  expect(f.autoExport).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(1);
});
test("missingManifestCommitIsReconciled and transcriptionLogAloneDoesNotAuthorizeRecovery", async () => {
  const f = await fixture();
  f.objects.delete(f.claim.history.checkpoint!.manifest.key);
  await recoverMeeting(f.claim, f.deps);
  expect(f.autoExport).not.toHaveBeenCalled();
  expect(f.notes).not.toHaveBeenCalled();
  expect(f.claim.history.recovery?.disposition).not.toBe("done");
});
test("invalid checksum-valid semantic context does not fall back to live settings", async () => {
  const f = await fixture();
  const read = f.deps.reader.readVerifiedObject;
  f.deps.reader = {
    ...f.reader,
    readVerifiedObject: async (ref, signal) =>
      ref.key.includes("/context/") ? Buffer.from("{}") : read(ref, signal),
  };
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery).toMatchObject({
    disposition: "needs_reconciliation",
    reason: "invalid_payload",
  });
  expect(f.autoExport).not.toHaveBeenCalled();
  expect(f.notes).not.toHaveBeenCalled();
});
test("exhaustedAttemptsClearAutomaticEligibility", async () => {
  const f = await fixture();
  f.claim.history.recovery!.attempt = 4;
  f.histories.get("guild")![0].recovery!.attempt = 4;
  f.deps.notes = async () => {
    throw new Error("provider failed");
  };
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery).toMatchObject({
    disposition: "needs_reconciliation",
    reason: "retry_exhausted",
    retry: { nextAttemptAt: null },
  });
});

test.each(["complete", "interrupted"] as const)(
  "acknowledged terminal %s delivery reconciles without a send",
  async (status) => {
    const f = await fixture();
    await recoverMeeting(f.claim, f.deps);
    const capture =
      status === "complete"
        ? {
            kind: "complete" as const,
            startedAt: f.claim.history.timestamp,
            endedAt: f.claim.history.timestamp,
          }
        : f.claim.history.capture;
    f.claim.history = {
      ...f.claim.history,
      status,
      capture,
      recovery: {
        attempt: 1,
        executionVersion: 2,
        stage: "delivery",
        disposition: "needs_reconciliation",
        reason: "delivery_uncertain",
        retry: { maxAttempts: 4, nextAttemptAt: null },
      },
    };
    Object.assign(
      f.histories.get("guild")![0],
      structuredClone(f.claim.history),
    );
    f.autoExport.mockClear();
    f.send.mockClear();
    f.notes.mockClear();
    await recoverMeeting(f.claim, f.deps);
    expect(f.claim.history.status).toBe(status);
    expect(f.claim.history.capture).toEqual(capture);
    expect(f.claim.history.recovery?.disposition).toBe("done");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.autoExport).not.toHaveBeenCalled();
    expect(f.notes).not.toHaveBeenCalled();
  },
);
test("partial IDs and missing original policy keep explicit reconciliation", async () => {
  const f = await fixture();
  await recoverMeeting(f.claim, f.deps);
  f.claim.history = {
    ...f.claim.history,
    notesMessageIds: [],
    recovery: {
      attempt: 1,
      executionVersion: 2,
      stage: "delivery",
      disposition: "needs_reconciliation",
      reason: "delivery_uncertain",
      retry: { maxAttempts: 4, nextAttemptAt: null },
    },
  };
  Object.assign(f.histories.get("guild")![0], structuredClone(f.claim.history));
  f.send.mockClear();
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery?.disposition).toBe("needs_reconciliation");
  expect(f.send).not.toHaveBeenCalled();
  const complete = await fixture();
  complete.claim.history.capture = {
    kind: "complete",
    startedAt: complete.claim.history.timestamp,
    endedAt: complete.claim.history.timestamp,
  };
  Object.assign(
    complete.histories.get("guild")![0],
    structuredClone(complete.claim.history),
  );
  await recoverMeeting(complete.claim, complete.deps);
  expect(complete.claim.history.recovery).toMatchObject({
    disposition: "needs_reconciliation",
    reason: "policy_unknown",
  });
  expect(complete.autoExport).not.toHaveBeenCalled();
  expect(complete.notes).not.toHaveBeenCalled();
});
test("restart resumes acknowledged notes and verified transcript, retrying only failed summary", async () => {
  const f = await fixture();
  const original = f.deps.summaries;
  f.deps.summaries = async () => {
    throw new Error("summary failure");
  };
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery?.disposition).toBe("failed");
  expect(f.claim.history.recoveryTranscript).toBeDefined();
  expect(f.claim.history.processing?.notes).toBe("generated");
  f.deps.summaries = original;
  f.deps.transcript = async () => {
    throw new Error("transcription should not repeat");
  };
  f.notes.mockClear();
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery?.disposition).toBe("done");
  expect(f.notes.mock.calls[0][0].notesText).toBeTruthy();
});

test.each(["Earlier acknowledged discussion.", "Thanks."])(
  "opportunistic transcript %s does not suppress later PCM intervals",
  async (text) => {
    const bytes = Buffer.alloc(384000);
    const f = await fixture(text, {
      transcript: (saved) => {
        saved.entries[0].revision = 2;
      },
      context: (saved) => {
        saved.prompts.transcription = {
          availability: "available",
          value: {
            name: "original",
            type: "text",
            label: "original",
            version: 1,
            template: "Saved transcription prompt",
          },
        };
      },
      artifacts: [
        {
          kind: "audio",
          sourceId: "user:456",
          sequence: 2,
          contentType: "audio/pcm",
          bytes,
          checksumSha256: createHash("sha256").update(bytes).digest("hex"),
          format: { encoding: "pcm_s16le", channels: 2, sampleRate: 48000 },
          coverage: {
            kind: "known",
            intervals: [
              { sourceId: "user:456", startOffsetMs: 5000, durationMs: 1000 },
              { sourceId: "user:456", startOffsetMs: 15000, durationMs: 1000 },
            ],
          },
        },
      ],
    });
    await recoverMeeting(f.claim, f.deps);
    expect(transcribeContentSnippet).toHaveBeenCalledTimes(2);
    const calls = jest.mocked(transcribeContentSnippet).mock.calls;
    expect(calls.map(([, snippet]) => snippet.timestamp)).toEqual([
      Date.parse(f.claim.history.timestamp) + 5000,
      Date.parse(f.claim.history.timestamp) + 15000,
    ]);
    expect(calls.map(([, snippet]) => snippet.chunks[0].length)).toEqual([
      192000, 192000,
    ]);
    expect(f.notes.mock.calls[0][0].finalTranscript).toContain(
      "Later verified discussion.",
    );
    if (text.startsWith("Earlier"))
      expect(f.notes.mock.calls[0][0].finalTranscript).toContain(text);
    expect(f.claim.history.recovery).toMatchObject({
      disposition: "done",
      outcome: "completed",
    });
  },
);

test.each([
  { chunkSeconds: 0, minChunkSeconds: 0 },
  { estimatedMp3BytesPerSecond: 0 },
  { targetMaxChunkBytes: 0 },
  { maxRequestBytes: 0 },
  { chunkSeconds: -1 },
  { minChunkSeconds: 901 },
  { targetMaxChunkBytes: 30000000 },
  { chunkSeconds: 1e12 },
])(
  "checksum-valid malformed final-pass budgets reconcile before dispatch: %j",
  async (invalid) => {
    const f = await fixture(undefined, {
      context: (saved) => {
        if (saved.settings.availability !== "available")
          throw new Error("fixture");
        saved.settings.value.processing = structuredClone(
          liveTranscriptionProcessingSettings,
        );
        Object.assign(saved.settings.value.processing.finalPass, invalid);
      },
    });
    await recoverMeeting(f.claim, f.deps);
    expect(f.claim.history.recovery).toMatchObject({
      disposition: "needs_reconciliation",
      reason: "invalid_payload",
    });
    expect(transcribeContentSnippet).not.toHaveBeenCalled();
    expect(f.autoExport).not.toHaveBeenCalled();
    expect(f.notes).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  },
);

test("handled generation failure never reaches the ancillary callback", async () => {
  const f = await fixture();
  f.deps.notes = async () => {
    throw new Error("Generated notes failure");
  };
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery?.disposition).toBe("failed");
  expect(f.send).not.toHaveBeenCalled();
  expect(f.autoExport).not.toHaveBeenCalled();
});
test("transcription disabled never reaches the ancillary callback", async () => {
  const f = await fixture(undefined, {
    requested: { transcribeMeeting: false, generateNotes: true },
  });
  await recoverMeeting(f.claim, f.deps);
  expect(f.claim.history.recovery).toMatchObject({
    disposition: "done",
    outcome: "disabled",
  });
  expect(f.notes).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.autoExport).not.toHaveBeenCalled();
});
