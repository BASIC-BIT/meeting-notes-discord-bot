import { buildMeetingDetails } from "../meetingLibrary";

describe("buildMeetingDetails", () => {
  const channelMap = new Map([["voice-1", "General"]]);

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

    const result = buildMeetingDetails(detail, channelMap);

    expect(result.summaryFeedback).toBe("up");
  });

  it("preserves down feedback from detail payload", () => {
    const detail = {
      id: "voice-1#2025-12-31T12:00:00.000Z",
      meetingId: "meeting-1",
      channelId: "voice-1",
      timestamp: "2025-12-31T12:00:00.000Z",
      duration: 1200,
      tags: ["weekly"],
      notes: "Summary: Needs changes.",
      summarySentence: "Needs changes.",
      summaryLabel: "Weekly sync",
      summaryFeedback: "down" as const,
    };

    const result = buildMeetingDetails(detail, channelMap);

    expect(result.summaryFeedback).toBe("down");
  });

  it("defaults summary feedback to null when omitted", () => {
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
    };

    const result = buildMeetingDetails(detail, channelMap);

    expect(result.summaryFeedback).toBeNull();
  });
});
