import { describe, expect, test } from "@jest/globals";
import type { MeetingHistory } from "../../src/types/db";
import {
  buildAskCitations,
  renderAskAnswer,
  stripCitationTags,
} from "../../src/services/askCitations";

const buildMeeting = (
  overrides: Partial<MeetingHistory> = {},
): MeetingHistory => ({
  guildId: "guild-1",
  channelId_timestamp: "voice-1#2025-01-01T00:00:00.000Z",
  meetingId: "meeting-1",
  channelId: "voice-1",
  timestamp: "2025-01-01T00:00:00.000Z",
  participants: [],
  duration: 60,
  transcribeMeeting: true,
  generateNotes: true,
  ...overrides,
});

describe("askCitations", () => {
  test("builds citations from valid tags and dedupes", () => {
    const meetings = [
      buildMeeting({
        channelId_timestamp: "voice-1#2025-01-01T00:00:00.000Z",
        notesChannelId: "text-1",
        notesMessageIds: ["note-1"],
      }),
      buildMeeting({
        channelId_timestamp: "voice-2#2025-01-02T00:00:00.000Z",
        notesChannelId: "text-2",
        notesMessageIds: ["note-2"],
      }),
    ];
    const text =
      'Answer <chronote:cite index="1" target="portal" /> ' +
      '<chronote:cite index="1" target="portal" /> ' +
      '<chronote:cite index="2" target="discord_summary" /> ' +
      '<chronote:cite index="3" target="portal" />';
    const citations = buildAskCitations({ text, meetings });

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      index: 1,
      target: "portal",
      meetingId: meetings[0].channelId_timestamp,
    });
    expect(citations[1]).toMatchObject({
      index: 2,
      target: "discord_summary",
      meetingId: meetings[1].channelId_timestamp,
      notesChannelId: "text-2",
      notesMessageId: "note-2",
    });
  });

  test("renders sources list and strips tags", () => {
    const meetings = [
      buildMeeting({
        channelId_timestamp: "voice-1#2025-01-01T00:00:00.000Z",
      }),
    ];
    const text = 'Decision <chronote:cite index="1" target="portal" />';
    const citations = buildAskCitations({ text, meetings });
    const rendered = renderAskAnswer({
      text,
      citations,
      guildId: "guild-1",
      portalBaseUrl: "https://app.example.com",
    });

    expect(rendered).toContain("Decision [1]");
    expect(rendered).toContain("Sources:");
    expect(rendered).toContain(
      "https://app.example.com/portal/server/guild-1/library?meetingId=voice-1%232025-01-01T00%3A00%3A00.000Z",
    );
  });

  test("captures transcript event IDs and can omit sources", () => {
    const meetings = [
      buildMeeting({
        channelId_timestamp: "voice-1#2025-01-01T00:00:00.000Z",
      }),
    ];
    const text =
      'Line <chronote:cite index="1" target="transcript" eventId="line-42" />';
    const citations = buildAskCitations({ text, meetings });
    const rendered = renderAskAnswer({
      text,
      citations,
      guildId: "guild-1",
      portalBaseUrl: "https://app.example.com",
      includeSources: false,
    });

    expect(citations[0]?.eventId).toBe("line-42");
    expect(rendered).toBe("Line [1]");
  });

  test("strips citation tags from text", () => {
    const cleaned = stripCitationTags(
      'Answer <chronote:cite index="1" target="portal" />',
    );
    expect(cleaned).toBe("Answer");
  });
});
