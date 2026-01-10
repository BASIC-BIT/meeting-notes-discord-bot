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

type EmbedPayload = { description?: string };
type EmbedLike = { toJSON?: () => EmbedPayload; data?: EmbedPayload };

describe("updateMeetingSummaryMessage", () => {
  it("edits the start message when available", async () => {
    const message = {
      id: "start-message",
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const notesMessage = {
      id: "notes-message",
    };
    const textChannel = {
      id: "text-1",
      messages: { fetch: jest.fn().mockResolvedValue(message) },
      send: jest.fn().mockResolvedValue(notesMessage),
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
    expect(editPayload.embeds).toHaveLength(1);
    const summaryEmbed =
      editPayload.embeds[0].toJSON?.() ?? editPayload.embeds[0].data;
    expect(summaryEmbed?.description).toContain("Summary text.");
    expect(textChannel.send).toHaveBeenCalledTimes(1);
    const sendPayload = textChannel.send.mock.calls[0][0];
    const notesEmbed =
      sendPayload.embeds[0].toJSON?.() ?? sendPayload.embeds[0].data;
    expect(notesEmbed?.description).toContain("Notes content.");
    expect(meeting.summaryMessageId).toBe("start-message");
    expect(meeting.notesMessageIds).toEqual(["notes-message"]);
    expect(meeting.notesChannelId).toBe("text-1");
  });

  it("sends a new message when the start message cannot be edited", async () => {
    const message = {
      id: "new-message",
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const notesMessage = {
      id: "notes-message",
    };
    const textChannel = {
      id: "text-2",
      messages: { fetch: jest.fn().mockRejectedValue(new Error("missing")) },
      send: jest
        .fn()
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce(notesMessage),
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

    expect(textChannel.send).toHaveBeenCalledTimes(2);
    const sendPayload = textChannel.send.mock.calls[0][0];
    expect(sendPayload.embeds).toHaveLength(1);
    expect(meeting.startMessageId).toBe("new-message");
    expect(meeting.summaryMessageId).toBe("new-message");
    expect(meeting.notesMessageIds).toEqual(["notes-message"]);
    expect(meeting.notesChannelId).toBe("text-2");
  });
  it("handles empty notes text by posting a fallback embed", async () => {
    const message = {
      id: "start-message",
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const notesMessage = {
      id: "notes-message",
    };
    const textChannel = {
      id: "text-3",
      messages: { fetch: jest.fn().mockResolvedValue(message) },
      send: jest.fn().mockResolvedValue(notesMessage),
    };
    const meeting = {
      meetingId: "meeting-3",
      guildId: "guild-3",
      startMessageId: "start-message",
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: new Date("2025-01-01T01:00:00.000Z"),
      attendance: new Set(["User Three"]),
      voiceChannel: { id: "voice-3", name: "Voice" },
      textChannel,
      generateNotes: true,
      notesText: "   ",
      summarySentence: "Summary text.",
    } as unknown as MeetingData;

    await updateMeetingSummaryMessage(meeting);

    const sendPayload = textChannel.send.mock.calls[0][0];
    expect(sendPayload.embeds).toHaveLength(1);
    const notesEmbed =
      sendPayload.embeds[0].toJSON?.() ?? sendPayload.embeds[0].data;
    expect(notesEmbed?.description).toContain("Notes unavailable.");
  });

  it("chunks long notes across multiple embeds", async () => {
    const message = {
      id: "start-message",
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const notesMessage = {
      id: "notes-message",
    };
    const textChannel = {
      id: "text-4",
      messages: { fetch: jest.fn().mockResolvedValue(message) },
      send: jest.fn().mockResolvedValue(notesMessage),
    };
    const longNotes = "A".repeat(9000);
    const meeting = {
      meetingId: "meeting-4",
      guildId: "guild-4",
      startMessageId: "start-message",
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: new Date("2025-01-01T01:00:00.000Z"),
      attendance: new Set(["User Four"]),
      voiceChannel: { id: "voice-4", name: "Voice" },
      textChannel,
      generateNotes: true,
      notesText: longNotes,
      summarySentence: "Summary text.",
    } as unknown as MeetingData;

    await updateMeetingSummaryMessage(meeting);

    const sendPayload = textChannel.send.mock.calls[0][0];
    expect(sendPayload.embeds.length).toBeGreaterThan(1);
    const descriptions = (sendPayload.embeds as EmbedLike[]).map((embed) => {
      const payload = embed.toJSON?.() ?? embed.data;
      return payload?.description ?? "";
    });
    expect(descriptions.join("").length).toBe(longNotes.length);
  });
});
