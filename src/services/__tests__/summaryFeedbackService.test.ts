import { getFeedbackRepository } from "../../repositories/feedbackRepository";
import { getMockStore, resetMockStore } from "../../repositories/mockStore";
import { submitMeetingSummaryFeedback } from "../summaryFeedbackService";

describe("submitMeetingSummaryFeedback", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("stores feedback for an existing meeting", async () => {
    const store = getMockStore();
    const guildId = "1249723747896918109";
    const meeting = store.meetingHistoryByGuild.get(guildId)?.[0];
    expect(meeting).toBeDefined();
    if (!meeting) return;

    const result = await submitMeetingSummaryFeedback({
      guildId,
      channelIdTimestamp: meeting.channelId_timestamp,
      userId: "user-1",
      userTag: "User#0001",
      displayName: "User",
      rating: "up",
      comment: "Great summary.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.historyFound).toBe(true);

    const fetched = await getFeedbackRepository().get(
      result.record.pk,
      result.record.sk,
    );
    expect(fetched).toBeDefined();
    expect(fetched?.rating).toBe("up");
    expect(fetched?.comment).toBe("Great summary.");
    expect(fetched?.summarySentence).toBe(meeting.summarySentence);
  });

  it("stores feedback even if meeting is missing", async () => {
    const result = await submitMeetingSummaryFeedback({
      guildId: "missing",
      channelIdTimestamp: "missing#2025-01-01T00:00:00.000Z",
      userId: "user-2",
      rating: "down",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.historyFound).toBe(false);
  });

  it("trims long comments", async () => {
    const store = getMockStore();
    const guildId = "1249723747896918109";
    const meeting = store.meetingHistoryByGuild.get(guildId)?.[0];
    expect(meeting).toBeDefined();
    if (!meeting) return;

    const comment = "a".repeat(1205);
    const result = await submitMeetingSummaryFeedback({
      guildId,
      channelIdTimestamp: meeting.channelId_timestamp,
      userId: "user-3",
      rating: "down",
      comment,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.comment?.length).toBe(1000);
  });
});
