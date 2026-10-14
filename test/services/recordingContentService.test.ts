/** @jest-environment node */
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
jest.mock("../../src/services/savedRecordingPrompt", () => ({
  ...jest.requireActual("../../src/services/savedRecordingPrompt"),
  snapshotRecordingPrompt: jest.fn(
    async (name: string, type: string, label: string) => ({
      name,
      type,
      label,
      version: 11,
      template:
        type === "text"
          ? "{{transcript}}"
          : [{ role: "user", content: "{{transcript}} {{notes}}" }],
    }),
  ),
}));
jest.mock("../../src/services/contextService", () => ({
  ...jest.requireActual("../../src/services/contextService"),
  collectMeetingContext: jest.fn(async () => ({
    availability: "available",
    data: { serverContext: "original generated context" },
  })),
}));
jest.mock("../../src/services/meetingNameService", () => ({
  listRecentMeetingNamesForPrompt: jest.fn(async () => "Original names"),
}));
import { Collection } from "discord.js";
import { resolveMeetingRuntimeConfig } from "../../src/services/meetingConfigService";
import {
  startRecordingContentCheckpoint,
  checkpointCompletedTranscription,
  checkpointRecordingContext,
} from "../../src/services/recordingContentService";
import { snapshotRecordingPrompt } from "../../src/services/savedRecordingPrompt";
import { collectMeetingContext } from "../../src/services/contextService";
import {
  generationContextSchema,
  completedTranscriptionSchema,
} from "../../src/types/recordingContent";
import type { MeetingData } from "../../src/types/meeting-data";
import type { CheckpointArtifactInput } from "../../src/types/recordingCheckpoint";

async function fixture(transcribeMeeting = true) {
  const artifacts: CheckpointArtifactInput[] = [];
  const runtimeConfig = await resolveMeetingRuntimeConfig({
    guildId: "generated",
    channelId: "voice",
    userId: "creator",
  });
  const meeting = {
    isAutoRecording: false,
    meetingId: "generated-meeting",
    guildId: "generated",
    channelId: "voice",
    transcribeMeeting,
    generateNotes: true,
    captureStartedAt: new Date(2000),
    creator: { id: "creator" },
    runtimeConfig,
    reservation: {
      sessionMode: "meeting",
      meetingId: "generated-meeting",
      guildId: "generated",
      ownerInstanceId: "owner",
      executionVersion: 1,
      voiceOperationAttemptId: "voice",
      reservedAt: 1000,
      historyKey: {
        guildId: "generated",
        channelId_timestamp: "voice#1970-01-01T00:00:01.000Z",
      },
    },
    ownershipSignal: new AbortController().signal,
    recordingCapture: {
      queueContent: (artifact: CheckpointArtifactInput) => {
        artifacts.push(artifact);
        return true;
      },
    },
    guild: {
      id: "generated",
      name: "Generated server",
      roles: new Collection(),
      scheduledEvents: new Collection(),
      channels: new Collection(),
      members: {},
      client: {},
    },
    voiceChannel: { name: "Generated voice" },
    participants: new Map([
      ["speaker", { id: "speaker", username: "Speaker" }],
    ]),
    attendance: new Set(["<@speaker>"]),
    chatLog: [],
    audioData: { audioFiles: [] },
  } as unknown as MeetingData;
  return { meeting, artifacts };
}

test("completedTranscriptionCheckpointSurvivesWithoutFinalization", async () => {
  const { meeting, artifacts } = await fixture();
  startRecordingContentCheckpoint(meeting);
  await meeting.recordingContentTask;
  meeting.audioData.audioFiles.push({
    userId: "speaker",
    timestamp: 2000,
    transcript: "Usable generated speech",
    processing: false,
    audioOnlyProcessing: false,
  });
  checkpointCompletedTranscription(meeting);
  const payload = completedTranscriptionSchema.parse(
    JSON.parse(Buffer.from(artifacts.at(-1)!.bytes).toString()),
  );
  expect(payload.entries[0].text).toBe("Usable generated speech");
  expect(payload.capture.requested).toEqual({
    transcribeMeeting: true,
    generateNotes: true,
  });
  expect(meeting.finalization).toBeUndefined();
});

test("later model/context changes cannot rewrite original generation settings", async () => {
  const { meeting, artifacts } = await fixture();
  startRecordingContentCheckpoint(meeting);
  await meeting.recordingContentTask;
  const before = generationContextSchema.parse(
    JSON.parse(Buffer.from(artifacts.at(-1)!.bytes).toString()),
  );
  meeting.runtimeConfig!.modelChoices = { notes: "changed-later" };
  jest.mocked(collectMeetingContext).mockResolvedValueOnce({
    availability: "available",
    data: { serverContext: "changed history" },
  });
  checkpointRecordingContext(meeting);
  const after = generationContextSchema.parse(
    JSON.parse(Buffer.from(artifacts.at(-1)!.bytes).toString()),
  );
  expect(after.settings).toEqual(before.settings);
  expect(after.context).toEqual(before.context);
  expect(after.prompts.notes).toMatchObject({
    availability: "available",
    value: { version: 11 },
  });
  expect(() =>
    generationContextSchema.parse({
      ...after,
      connection: { secret: "forbidden" },
    }),
  ).toThrow();
});

test("disabled generation does not fetch unused templates", async () => {
  jest.mocked(snapshotRecordingPrompt).mockClear();
  const { meeting } = await fixture(false);
  startRecordingContentCheckpoint(meeting);
  await meeting.recordingContentTask;
  expect(snapshotRecordingPrompt).not.toHaveBeenCalled();
});

test("late usable transcript caller publishes after PCM completion without changing capture facts", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { createRecordingCheckpointCapture } =
    await import("../../src/services/recordingCheckpointCapture");
  const { createRecordingCheckpointService } =
    await import("../../src/services/recordingCheckpointService");
  const { createMockDeploymentControlRepository } =
    await import("../../src/repositories/deploymentControlRepository");
  const { history } = await import("../deployment/controlFixtures");
  const { meeting } = await fixture();
  const directory = mkdtempSync(path.join(tmpdir(), "late-content-"));
  const controller = new AbortController();
  meeting.ownershipSignal = controller.signal;
  const row = {
    ...history,
    guildId: meeting.guildId,
    channelId: meeting.channelId,
    meetingId: meeting.meetingId,
    channelId_timestamp: meeting.reservation!.historyKey!.channelId_timestamp,
    timestamp: new Date(1000).toISOString(),
    ownerInstanceId: "owner",
    executionVersion: 1,
    status: "in_progress" as const,
  };
  const repository = createMockDeploymentControlRepository(
    new Map(),
    new Map([[meeting.guildId, [row]]]),
    new Map([
      [
        meeting.guildId,
        {
          guildId: meeting.guildId,
          meetingId: meeting.meetingId,
          ownerInstanceId: "owner",
          executionVersion: 1,
          voiceOperationAttemptId: "voice",
          sessionMode: "meeting",
          voiceChannelId: meeting.channelId,
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
  const producer = createRecordingCheckpointService({
    repository,
    objects: {
      upload: async (key, bytes) => {
        if (!objects.has(key)) objects.set(key, Buffer.from(bytes));
        return key;
      },
      read: async (key) => objects.get(key),
    },
  }).createProducerSession();
  let audioCommits = 0;
  meeting.recordingCapture = createRecordingCheckpointCapture({
    directory,
    startedAt: 2000,
    signal: controller.signal,
    commit: async (artifacts, signal) => {
      if (artifacts.some((artifact) => artifact.kind === "audio")) {
        audioCommits++;
        checkpointRecordingContext(meeting);
      }
      return (
        (
          await producer.appendArtifactsRecordingCheckpoint(
            meeting,
            [...artifacts],
            signal,
          )
        ).kind === "committed"
      );
    },
    stopCapture: jest.fn(),
  });
  try {
    meeting.recordingCaptureState = {
      kind: "capturing",
      startedAt: new Date(2000).toISOString(),
    };
    startRecordingContentCheckpoint(meeting);
    await meeting.recordingContentTask;
    expect(await meeting.recordingCapture.drainContent()).toBe(true);
    meeting.recordingCapture.push("user:speaker", Buffer.alloc(3840), 2000);
    const complete = {
      kind: "complete" as const,
      startedAt: new Date(2000).toISOString(),
      endedAt: new Date(3000).toISOString(),
    };
    meeting.recordingCaptureState = complete;
    expect(await meeting.recordingCapture.finish()).toBe(true);
    expect(audioCommits).toBe(1);
    const audioPointer = meeting.recordingCheckpoint!;
    meeting.audioData.audioFiles.push({
      userId: "speaker",
      timestamp: 2000,
      transcript: "Late usable speech",
      processing: false,
      audioOnlyProcessing: false,
    });
    checkpointCompletedTranscription(meeting);
    expect(await meeting.recordingCapture.drainContent()).toBe(true);
    const verified = await producer.read(meeting.recordingCheckpoint!);
    expect(verified.manifest.captureState).toEqual(complete);
    expect(meeting.recordingCheckpoint!.capture).toEqual(audioPointer.capture);
    const text = verified.verified
      .filter((artifact) => artifact.kind === "transcription")
      .at(-1)!;
    expect(
      JSON.parse(objects.get(text.object.key)!.toString()).entries[0].text,
    ).toBe("Late usable speech");
    const finalPointer = meeting.recordingCheckpoint;
    controller.abort();
    checkpointCompletedTranscription(meeting);
    await meeting.recordingCapture.settled();
    expect(meeting.recordingCheckpoint).toBe(finalPointer);
    expect(meeting.finalization).toBeUndefined();
    meeting.recordingCapture.releaseSettledBuffers();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot settlement waits for every real lookup even when context fails first", async () => {
  const { meeting } = await fixture();
  jest
    .mocked(collectMeetingContext)
    .mockRejectedValueOnce(new Error("generated context unavailable"));
  let complete!: () => void;
  jest.mocked(snapshotRecordingPrompt).mockImplementationOnce(
    (name, type, label) =>
      new Promise((resolve) => {
        expect(type).toBe("text");
        complete = () =>
          resolve({
            name,
            type: "text",
            label,
            version: 1,
            template: "{{transcript}}",
          });
      }),
  );
  startRecordingContentCheckpoint(meeting);
  let settled = false;
  void meeting.recordingContentTask!.then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  complete();
  await meeting.recordingContentTask;
  expect(settled).toBe(true);
});
