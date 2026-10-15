/** @jest-environment node */
jest.mock("../../src/services/configService", () => ({
  config: { frontend: { siteUrl: "https://example.invalid" } },
}));
jest.mock("../../src/commands/summaryFeedback", () => ({
  buildSummaryFeedbackButtonIds: () => ({ up: "up", down: "down" }),
}));
jest.mock("../../src/commands/meetingName", () => ({
  MEETING_RENAME_PREFIX: "rename",
}));
jest.mock("../../src/services/summaryUpgradeService", () => ({
  claimSummaryUpgrade: async () => undefined,
}));
jest.mock("../../src/services/analyticsService", () => ({
  captureEvent: jest.fn(),
}));
jest.mock("../../src/services/langfuseClient", () => ({
  isLangfuseTracingEnabled: () => false,
}));
jest.mock("@langfuse/tracing", () => ({ updateActiveObservation: jest.fn() }));
const mockRepository = {
  getMeetingHistory: jest.fn(),
  transitionMeetingHistory: jest.fn(),
};
jest.mock("../../src/db", () => ({
  getDeploymentControlRepository: () => mockRepository,
}));
import { updateMeetingSummaryMessage } from "../../src/embed";
import { acknowledgeRecordingDeliveryHistory } from "../../src/services/recordingDeliveryService";
import type { MeetingData } from "../../src/types/meeting-data";
import type { MeetingHistory } from "../../src/types/db";
function fixture() {
  const original = {
    guildId: "synthetic",
    meetingId: "synthetic",
    ownerInstanceId: "owner",
    executionVersion: 1,
    voiceOperationAttemptId: "voice",
    sessionMode: "meeting",
    historyKey: { guildId: "synthetic", channelId_timestamp: "voice#start" },
  };
  const edit = jest.fn(async () => undefined);
  const send = jest.fn();
  const meeting = {
    ...original,
    reservation: original,
    creator: { id: "synthetic" },
    startMessageId: "summary",
    startTime: new Date(0),
    endTime: new Date(120000),
    attendance: new Set(),
    voiceChannel: { id: "voice", name: "Voice" },
    textChannel: {
      id: "text",
      messages: { fetch: jest.fn(async () => ({ id: "summary", edit })) },
      send,
    },
    generateNotes: true,
    notesText: "A".repeat(5900),
    summarySentence: "Synthetic",
    processing: { transcription: "partial", notes: "generated" },
  } as unknown as MeetingData;
  const row = {
    ...original,
    status: "processing",
    checkpoint: { revision: 3 },
  } as unknown as MeetingHistory;
  mockRepository.getMeetingHistory.mockImplementation(async () =>
    structuredClone(row),
  );
  mockRepository.transitionMeetingHistory.mockImplementation(async (input) => {
    Object.assign(row, input.patch);
    return "applied";
  });
  return { meeting, row, edit, send };
}
beforeEach(() => jest.resetAllMocks());
test("held and lost pre-intent ACK issues zero Discord mutations", async () => {
  const { meeting, row, edit, send } = fixture();
  let release!: () => void;
  mockRepository.transitionMeetingHistory.mockImplementationOnce(
    async (input) => {
      await new Promise<void>((done) => {
        release = done;
      });
      Object.assign(row, input.patch);
      throw new Error("lost intent ACK");
    },
  );
  const actual = updateMeetingSummaryMessage(meeting, { finalization: true });
  const outcome = actual.catch(() => "unknown");
  await new Promise<void>((done) => setImmediate(done));
  expect(edit).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  release();
  await outcome;
  expect(edit).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(row.recovery).toMatchObject({
    disposition: "needs_reconciliation",
    reason: "delivery_uncertain",
  });
});
test("partial batch lost send ACK retains known IDs and a restarted producer cannot replay", async () => {
  const { meeting, row, send } = fixture();
  send
    .mockResolvedValueOnce({ id: "first-notes" })
    .mockRejectedValueOnce(new Error("lost second send ACK"));
  await expect(
    updateMeetingSummaryMessage(meeting, { finalization: true }),
  ).rejects.toThrow("lost second");
  expect(row).toMatchObject({
    summaryMessageId: "summary",
    notesMessageIds: ["first-notes"],
    notesChannelId: "text",
    recovery: {
      stage: "delivery",
      disposition: "needs_reconciliation",
      reason: "delivery_uncertain",
    },
  });
  expect(send).toHaveBeenCalledTimes(2);
  await expect(
    updateMeetingSummaryMessage({ ...meeting }, { finalization: true }),
  ).rejects.toThrow("replayed");
  expect(send).toHaveBeenCalledTimes(2);
});
test("all actual message ACKs plus terminal history allow exact delivery done", async () => {
  const { meeting, row, send } = fixture();
  send
    .mockResolvedValueOnce({ id: "first-notes" })
    .mockResolvedValueOnce({ id: "second-notes" });
  await updateMeetingSummaryMessage(meeting, { finalization: true });
  expect(row.recovery?.disposition).toBe("needs_reconciliation");
  row.status = "complete";
  await acknowledgeRecordingDeliveryHistory(meeting);
  expect(row.notesMessageIds).toEqual(["first-notes", "second-notes"]);
  expect(row.recovery).toMatchObject({
    disposition: "done",
    outcome: "completed",
    stage: "delivery",
  });
});
