jest.mock("../src/services/configService", () => ({
  config: { frontend: { siteUrl: "https://chronote.test" } },
}));
jest.mock("../src/commands/summaryFeedback", () => ({
  buildSummaryFeedbackButtonIds: (key: string) => ({
    up: `summary_feedback_up:${key}`,
    down: `summary_feedback_down:${key}`,
  }),
}));
jest.mock("../src/commands/meetingName", () => ({
  MEETING_RENAME_PREFIX: "rename_meeting",
}));

import { updateMeetingSummaryMessage } from "../src/embed";
import type { MeetingData } from "../src/types/meeting-data";

describe("updateMeetingSummaryMessage", () => {
  it("edits the start message when available", async () => {
    const message = {
      id: "start-message",
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const textChannel = {
      id: "text-1",
      messages: { fetch: jest.fn().mockResolvedValue(message) },
      send: jest.fn(),
    };
    const meeting = {
      meetingId: "meeting-1",
      guildId: "guild-1",
      startMessageId: "start-message",
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: new Date("2025-01-01T01:00:00.000Z"),
      attendance: new Set(["User One"]),
      voiceChannel: { id: "voice-1", name: "Voice" },
      textChannel,
      generateNotes: true,
      notesText: "Notes content.",
      summarySentence: "Summary text.",
      tags: ["tag-1"],
    } as unknown as MeetingData;

    await updateMeetingSummaryMessage(meeting);

    expect(textChannel.messages.fetch).toHaveBeenCalledWith("start-message");
    expect(message.edit).toHaveBeenCalled();
    const editPayload = message.edit.mock.calls[0][0];
    expect(editPayload.embeds).toHaveLength(2);
    const notesEmbed =
      editPayload.embeds[1].toJSON?.() ?? editPayload.embeds[1].data;
    expect(notesEmbed?.description).toContain("Notes content.");
    expect(textChannel.send).not.toHaveBeenCalled();
    expect(meeting.notesMessageIds).toEqual(["start-message"]);
    expect(meeting.notesChannelId).toBe("text-1");
  });

  it("sends a new message when the start message cannot be edited", async () => {
    const message = {
      id: "new-message",
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const textChannel = {
      id: "text-2",
      messages: { fetch: jest.fn().mockRejectedValue(new Error("missing")) },
      send: jest.fn().mockResolvedValue(message),
    };
    const meeting = {
      meetingId: "meeting-2",
      guildId: "guild-2",
      startMessageId: "missing-message",
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: new Date("2025-01-01T01:00:00.000Z"),
      attendance: new Set(["User Two"]),
      voiceChannel: { id: "voice-2", name: "Voice" },
      textChannel,
      generateNotes: true,
      notesText: "Notes content.",
      summarySentence: "Summary text.",
    } as unknown as MeetingData;

    await updateMeetingSummaryMessage(meeting);

    expect(textChannel.send).toHaveBeenCalled();
    const sendPayload = textChannel.send.mock.calls[0][0];
    expect(sendPayload.embeds).toHaveLength(2);
    expect(meeting.startMessageId).toBe("new-message");
    expect(meeting.notesMessageIds).toEqual(["new-message"]);
    expect(meeting.notesChannelId).toBe("text-2");
  });
});
