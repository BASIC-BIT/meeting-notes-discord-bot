import { describe, expect, test } from "@jest/globals";
import {
  buildMeetingDetails,
  deriveSummary,
  deriveTitle,
  filterMeetingItems,
  formatChannelLabel,
  formatDateLabel,
  formatDurationLabel,
} from "../../src/frontend/utils/meetingLibrary";

describe("meeting library utils", () => {
  test("formatChannelLabel prefixes channel names", () => {
    expect(formatChannelLabel("staff-chat")).toBe("#staff-chat");
    expect(formatChannelLabel("#staff-chat")).toBe("#staff-chat");
    expect(formatChannelLabel(undefined, "fallback")).toBe("#fallback");
  });

  test("formatDurationLabel handles hours and minutes", () => {
    expect(formatDurationLabel(59)).toBe("0m");
    expect(formatDurationLabel(60)).toBe("1m");
    expect(formatDurationLabel(3660)).toBe("1h 01m");
  });

  test("formatDateLabel returns fallback for invalid timestamps", () => {
    expect(formatDateLabel("not-a-date")).toBe("Unknown date");
  });

  test("deriveTitle skips headings and falls back to channel label", () => {
    const notes = ["- Highlights", "Decisions:", "* Roadmap kickoff"].join(
      "\n",
    );
    expect(deriveTitle(notes, "#planning")).toBe("Roadmap kickoff");
    expect(deriveTitle("", "#general")).toBe("Meeting in general");
  });

  test("deriveSummary prefers summary sentence and summary lines", () => {
    expect(deriveSummary("notes", " A summary sentence. ")).toBe(
      "A summary sentence.",
    );
    const notesWithSummary = ["- Summary: We shipped it", "Details..."].join(
      "\n",
    );
    expect(deriveSummary(notesWithSummary)).toBe("We shipped it");
    expect(deriveSummary("")).toBe(
      "Notes will appear after the meeting is processed.",
    );
  });

  test("filterMeetingItems respects query, tags, channel, and range", () => {
    const nowMs = Date.parse("2025-01-10T00:00:00.000Z");
    const items = [
      {
        title: "Project kickoff",
        summary: "Scope and timeline",
        tags: ["kickoff", "project"],
        channelId: "alpha",
        timestamp: "2025-01-09T00:00:00.000Z",
      },
      {
        title: "Retro",
        summary: "Summary line here",
        tags: ["retro"],
        channelId: "beta",
        timestamp: "2024-12-01T00:00:00.000Z",
      },
    ];

    const filtered = filterMeetingItems(items, {
      query: "kickoff",
      selectedTags: ["kickoff"],
      selectedChannel: "alpha",
      selectedRange: "30",
      nowMs,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("Project kickoff");
  });

  test("buildMeetingDetails fills defaults and derived fields", () => {
    const channelNameMap = new Map([["alpha", "planning"]]);
    const detail = {
      id: "alpha#123",
      meetingId: "meeting-1",
      channelId: "alpha",
      timestamp: "2025-01-02T00:00:00.000Z",
      duration: 90,
      notes: "",
      summarySentence: null,
      summaryLabel: null,
      attendees: [],
    };

    const built = buildMeetingDetails(detail, channelNameMap);

    expect(built.channel).toBe("#planning");
    expect(built.title).toBe("Meeting in planning");
    expect(built.notes).toBe("No notes recorded.");
    expect(built.attendees).toEqual(["Unknown"]);
    expect(built.status).toBe("complete");
  });
});
