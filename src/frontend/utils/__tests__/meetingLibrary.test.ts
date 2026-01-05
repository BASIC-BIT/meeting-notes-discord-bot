import { buildMeetingDetails } from "../meetingLibrary";

describe("buildMeetingDetails", () => {
  it("preserves summary feedback from detail payload", () => {
    const detail = {
      id: "voice-1#2025-12-31T12:00:00.000Z",
      meetingId: "meeting-1",
      channelId: "voice-1",
      timestamp: "2025-12-31T12:00:00.000Z",
      duration: 1200,
      tags: ["weekly"],
      notes: "Summary: All good.",
      summarySentence: "All good.",
      summaryLabel: "Weekly sync",
      summaryFeedback: "up" as const,
    };
    const channelMap = new Map([["voice-1", "General"]]);

    const result = buildMeetingDetails(detail, channelMap);

    expect(result.summaryFeedback).toBe("up");
  });
});
