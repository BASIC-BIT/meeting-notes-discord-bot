import { beforeEach, describe, expect, test, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { MeetingHistory } from "../../src/types/db";
import type { MeetingEvent } from "../../src/types/meetingTimeline";
import { getMockUser } from "../../src/repositories/mockStore";
import { appRouter } from "../../src/trpc/router";
import { ensureManageGuildWithUserToken } from "../../src/services/guildAccessService";
import { getMeetingHistoryService } from "../../src/services/meetingHistoryService";
import { buildMeetingTimelineEventsFromHistory } from "../../src/services/meetingTimelineService";
import { getMeetingSummaryFeedback } from "../../src/services/summaryFeedbackService";
import {
  fetchJsonFromS3,
  getSignedObjectUrl,
} from "../../src/services/storageService";

jest.mock("../../src/services/guildAccessService", () => ({
  ensureManageGuildWithUserToken: jest.fn(),
  ensureBotInGuild: jest.fn(),
}));

jest.mock("../../src/services/meetingHistoryService", () => ({
  getMeetingHistoryService: jest.fn(),
  listRecentMeetingsForGuildService: jest.fn(),
  updateMeetingArchiveService: jest.fn(),
  updateMeetingNameService: jest.fn(),
}));

jest.mock("../../src/services/storageService", () => ({
  fetchJsonFromS3: jest.fn(),
  getSignedObjectUrl: jest.fn(),
}));

jest.mock("../../src/services/meetingTimelineService", () => ({
  buildMeetingTimelineEventsFromHistory: jest.fn(),
}));

jest.mock("../../src/services/summaryFeedbackService", () => ({
  getMeetingSummaryFeedback: jest.fn(),
}));

const buildCaller = () =>
  appRouter.createCaller({
    req: { session: {} } as Request,
    res: {} as Response,
    user: getMockUser(),
  });

describe("meetings router detail", () => {
  const mockedEnsureManageGuild = jest.mocked(ensureManageGuildWithUserToken);
  const mockedGetMeetingHistory = jest.mocked(getMeetingHistoryService);
  const mockedFetchJsonFromS3 = jest.mocked(fetchJsonFromS3);
  const mockedGetSignedObjectUrl = jest.mocked(getSignedObjectUrl);
  const mockedBuildTimeline = jest.mocked(
    buildMeetingTimelineEventsFromHistory,
  );
  const mockedGetSummaryFeedback = jest.mocked(getMeetingSummaryFeedback);

  beforeEach(() => {
    jest.resetAllMocks();
    mockedEnsureManageGuild.mockResolvedValue(true);
  });

  test("returns transcript, audio url, and summary feedback", async () => {
    const meetingId = "channel-1#2025-01-01T00:00:00.000Z";
    const history: MeetingHistory = {
      guildId: "guild-1",
      channelId_timestamp: meetingId,
      meetingId: "meeting-1",
      channelId: "channel-1",
      timestamp: "2025-01-01T00:00:00.000Z",
      participants: [{ id: "user-1", username: "Tester" }],
      duration: 1800,
      transcribeMeeting: true,
      generateNotes: true,
      notes: "Summary: weekly sync",
      transcriptS3Key: "transcripts/meeting-1.json",
      audioS3Key: "audio/meeting-1.mp3",
    };

    const transcriptPayload = { text: "Transcript text" };
    const events: MeetingEvent[] = [
      {
        id: "event-1",
        type: "voice",
        time: "2025-01-01T00:10:00.000Z",
        text: "Hello team",
      },
    ];

    mockedGetMeetingHistory.mockResolvedValue(history);
    mockedFetchJsonFromS3.mockResolvedValueOnce(transcriptPayload);
    mockedGetSignedObjectUrl.mockResolvedValue("https://example.com/audio.mp3");
    mockedBuildTimeline.mockReturnValue(events);
    mockedGetSummaryFeedback.mockResolvedValue({ rating: "down" });

    const result = await buildCaller().meetings.detail({
      serverId: "guild-1",
      meetingId,
    });

    expect(result.meeting.transcript).toBe("Transcript text");
    expect(result.meeting.audioUrl).toBe("https://example.com/audio.mp3");
    expect(result.meeting.summaryFeedback).toBe("down");
    expect(result.meeting.events).toEqual(events);
    expect(mockedGetSummaryFeedback).toHaveBeenCalledWith({
      channelIdTimestamp: meetingId,
      userId: getMockUser().id,
    });
  });

  test("throws NOT_FOUND when meeting history is missing", async () => {
    mockedGetMeetingHistory.mockResolvedValue(undefined);

    await expect(
      buildCaller().meetings.detail({
        serverId: "guild-1",
        meetingId: "missing-meeting",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
