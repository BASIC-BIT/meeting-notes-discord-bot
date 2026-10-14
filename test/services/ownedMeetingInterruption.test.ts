/** @jest-environment node */
jest.mock("dotenv", () => ({ config: jest.fn() }));
import {
  interruptOwnedMeeting,
  getMeetingInterruptionCheckpoints,
} from "../../src/services/ownedMeetingInterruption";
import type { MeetingData } from "../../src/types/meeting-data";
import {
  closeOutputFile,
  waitForCaptureStreamSettlement,
} from "../../src/audio";
import { fenceAndSettleSessionWork } from "../../src/services/runtimeWorkAdmissionService";
import { stopMeetingProcessing } from "../../src/services/meetingProcessingLifetime";
import {
  getActiveMeetingLease,
  getDeploymentControlRepository,
} from "../../src/db";
import { createRecordingCheckpointService } from "../../src/services/recordingCheckpointService";
import { reconcilePreservedRecordingReservation } from "../../src/services/activeMeetingLeaseService";
const mockPreserve = jest.fn(async () => ({
  kind: "committed",
  checkpoint: { revision: 2 },
}));
const mockRead = jest.fn(async () => ({
  missing: [],
  manifest: { captureState: { kind: "complete" } },
}));
jest.mock("../../src/services/runtimeWorkAdmissionService", () => ({
  fenceAndSettleSessionWork: jest.fn(async () => true),
}));
jest.mock("../../src/audio", () => ({
  closeOutputFile: jest.fn(async () => {}),
  waitForCaptureStreamSettlement: jest.fn(async () => {}),
}));
jest.mock("../../src/commands/endMeeting", () => ({
  fenceMeetingFinalization: jest.fn((meeting) => {
    meeting.finishing = true;
    meeting.captureAudio = false;
    meeting.recordingCapture?.fence();
  }),
}));
jest.mock("../../src/services/meetingProcessingLifetime", () => ({
  stopMeetingProcessing: jest.fn(async () => {}),
}));
jest.mock("../../src/services/guildVoiceOperationService", () => ({
  settleOwnedVoiceSession: jest.fn(async () => "settled"),
}));
jest.mock("../../src/services/activeMeetingLeaseService", () => ({
  reconcilePreservedRecordingReservation: jest.fn(async () => true),
}));
jest.mock("../../src/meetings", () => ({
  getMeeting: jest.fn(),
  deleteMeeting: jest.fn(),
  restoreVoiceSessionNickname: jest.fn(async () => true),
}));
jest.mock("../../src/db", () => ({
  getActiveMeetingLease: jest.fn(),
  getDeploymentControlRepository: jest.fn(),
}));
jest.mock("../../src/services/recordingCheckpointService", () => ({
  createRecordingCheckpointService: jest.fn(() => ({
    read: mockRead,
    preserveInitialTerminalRecordingCheckpoint: mockPreserve,
    preserveTerminalRecordingCheckpoint: mockPreserve,
  })),
}));
function held() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { release, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPreserve.mockReset();
  mockPreserve.mockResolvedValue({
    kind: "committed",
    checkpoint: { revision: 2 },
  });
});
test.each([true, false])(
  "actual interruption adapter waits content, preservation, receiver and exact child disposition: %s",
  async (childrenSettled) => {
    jest
      .mocked(fenceAndSettleSessionWork)
      .mockResolvedValueOnce(childrenSettled);
    const processing = held();
    const receiver = held();
    const content = held();
    const preservation = held();
    jest.mocked(stopMeetingProcessing).mockReturnValueOnce(processing.promise);
    jest
      .mocked(waitForCaptureStreamSettlement)
      .mockReturnValueOnce(receiver.promise);
    const owner = {
      guildId: "synthetic",
      meetingId: "synthetic",
      ownerInstanceId: "original",
      executionVersion: 1,
      voiceOperationAttemptId: "original-voice",
      sessionMode: "meeting" as const,
    };
    const meeting = {
      ...owner,
      channelId: "voice",
      transcribeMeeting: true,
      generateNotes: true,
      reservation: {
        ...owner,
        reservedAt: 0,
        historyKey: {
          guildId: owner.guildId,
          channelId_timestamp: "voice#start",
        },
      },
      captureStartedAt: new Date(0),
      recordingCaptureState: {
        kind: "interrupted",
        startedAt: new Date(0).toISOString(),
        detectedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      recordingContentTask: content.promise,
      recordingPreservationTask: preservation.promise.then(() => false),
      recordingCapture: {
        fence: jest.fn(),
        settled: jest.fn(async () => {}),
        pending: () => [],
        releaseSettledBuffers: jest.fn(),
      },
      setFinished: jest.fn(),
      audioData: {},
      ownershipSignal: new AbortController().signal,
    } as unknown as MeetingData;
    jest.mocked(getActiveMeetingLease).mockResolvedValue({
      ...owner,
      leaseExpiresAt: Math.floor(Date.now() / 1000) + 120,
    } as never);
    jest.mocked(getDeploymentControlRepository).mockReturnValue({
      getMeetingHistory: jest.fn(async () => ({
        ...owner,
        status: "processing",
      })),
    } as never);
    const pending = interruptOwnedMeeting(meeting, {
      reason: "shutdown",
      deadline: Date.now() + 100000,
    });
    expect(meeting.captureAudio).toBe(false);
    expect(closeOutputFile).toHaveBeenCalledTimes(1);
    processing.release();
    receiver.release();
    content.release();
    await new Promise<void>((done) => setImmediate(done));
    expect(mockPreserve).not.toHaveBeenCalled();
    preservation.release();
    expect(await pending).toMatchObject({
      kind: childrenSettled ? "settled" : "unresolved",
    });
    expect(createRecordingCheckpointService).toHaveBeenCalled();
    expect(mockPreserve).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "processing",
        status: "interrupted",
        preservation: expect.objectContaining({
          ownership: expect.objectContaining(owner),
        }),
      }),
    );
    expect(reconcilePreservedRecordingReservation).toHaveBeenCalledTimes(
      childrenSettled ? 1 : 0,
    );
    expect(
      meeting.recordingCapture!.releaseSettledBuffers,
    ).toHaveBeenCalledTimes(childrenSettled ? 1 : 0);
    expect(meeting.ownershipSignal!.aborted).toBe(false);
  },
);

test.each(["complete", "processing"] as const)(
  "absent original lease permits only verified completed disposition: %s",
  async (status) => {
    const original = {
      guildId: `synthetic-${status}`,
      meetingId: "synthetic",
      ownerInstanceId: "original",
      executionVersion: 1,
      voiceOperationAttemptId: "original-voice",
      sessionMode: "meeting" as const,
      historyKey: {
        guildId: `synthetic-${status}`,
        channelId_timestamp: "voice#start",
      },
      reservedAt: 0,
    };
    const checkpoint = {
      revision: 1,
      capture: { ...original, ...original.historyKey },
    };
    const meeting = {
      reservation: original,
      guildId: original.guildId,
      channelId: "voice",
      captureStartedAt: new Date(0),
      recordingCheckpoint: checkpoint,
      transcribeMeeting: true,
      generateNotes: true,
      recordingCapture: {
        fence: jest.fn(),
        settled: jest.fn(async () => {}),
        pending: () => [],
        releaseSettledBuffers: jest.fn(),
      },
      setFinished: jest.fn(),
      audioData: {},
    } as unknown as MeetingData;
    jest.mocked(getActiveMeetingLease).mockResolvedValue(undefined);
    jest.mocked(getDeploymentControlRepository).mockReturnValue({
      getMeetingHistory: jest.fn(async () => ({
        ...original,
        checkpoint,
        status,
      })),
    } as never);
    mockPreserve.mockImplementationOnce(async () => {
      throw new Error("Original lease absent");
    });
    const result = await interruptOwnedMeeting(meeting, {
      reason: "processing_failure",
      deadline: Date.now() + 100000,
    });
    expect(result.kind).toBe(status === "complete" ? "settled" : "unresolved");
    expect(mockRead).toHaveBeenCalledWith(checkpoint, expect.any(AbortSignal));
    expect(mockPreserve).toHaveBeenCalledTimes(status === "complete" ? 0 : 1);
    expect(reconcilePreservedRecordingReservation).toHaveBeenCalledTimes(
      status === "complete" ? 1 : 0,
    );
    if (status === "processing")
      expect(getMeetingInterruptionCheckpoints()).toContainEqual(
        expect.objectContaining({
          meeting,
          originalAttempt: expect.objectContaining({ executionVersion: 1 }),
          lastAcknowledgedCheckpoint: checkpoint,
        }),
      );
  },
);
