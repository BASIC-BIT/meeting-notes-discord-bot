import { beforeEach, describe, expect, test, jest } from "@jest/globals";
import type { DictionaryEntry, MeetingHistory } from "../../src/types/db";
import type { MeetingData } from "../../src/types/meeting-data";
import { CONFIG_KEYS } from "../../src/config/keys";
import {
  buildMeetingContext,
  formatContextForPrompt,
} from "../../src/services/contextService";
import { fetchChannelContext } from "../../src/services/channelContextService";
import { listRecentMeetingsForChannelService } from "../../src/services/meetingHistoryService";
import { resolveConfigSnapshot } from "../../src/services/unifiedConfigService";

jest.mock("../../src/services/channelContextService", () => ({
  fetchChannelContext: jest.fn(),
}));
jest.mock("../../src/services/meetingHistoryService", () => ({
  listRecentMeetingsForChannelService: jest.fn(),
}));
jest.mock("../../src/services/unifiedConfigService", () => ({
  resolveConfigSnapshot: jest.fn(),
}));

const mockedFetchChannelContext = fetchChannelContext as jest.MockedFunction<
  typeof fetchChannelContext
>;
const mockedListRecentMeetings =
  listRecentMeetingsForChannelService as jest.MockedFunction<
    typeof listRecentMeetingsForChannelService
  >;
const mockedResolveConfigSnapshot =
  resolveConfigSnapshot as jest.MockedFunction<typeof resolveConfigSnapshot>;

const buildHistory = (
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

const buildMeeting = (overrides: Partial<MeetingData> = {}): MeetingData =>
  ({
    guildId: "guild-1",
    voiceChannel: { id: "voice-1" },
    meetingContext: "Discuss launch",
    dictionaryEntries: [
      {
        guildId: "guild-1",
        termKey: "chronote",
        term: "Chronote",
        definition: "Meeting notes bot",
        createdAt: "2025-01-01T00:00:00.000Z",
        createdBy: "user-1",
        updatedAt: "2025-01-01T00:00:00.000Z",
        updatedBy: "user-1",
      },
    ],
    runtimeConfig: {
      dictionary: {
        maxEntries: 3,
        maxCharsTranscription: 200,
        maxCharsContext: 500,
      },
    },
    ...overrides,
  }) as MeetingData;

describe("contextService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("buildMeetingContext composes server, channel, memory, and dictionary data", async () => {
    mockedResolveConfigSnapshot.mockResolvedValue({
      values: {
        [CONFIG_KEYS.context.instructions]: {
          value: "Server context",
          source: "server",
        },
      },
    } as Awaited<ReturnType<typeof resolveConfigSnapshot>>);
    mockedFetchChannelContext.mockResolvedValue({
      guildId: "guild-1",
      channelId: "voice-1",
      context: "Channel context",
      updatedAt: "2025-01-01T00:00:00.000Z",
      updatedBy: "user-1",
    });
    mockedListRecentMeetings.mockResolvedValue([buildHistory()]);

    const meeting = buildMeeting();
    const result = await buildMeetingContext(meeting, true);

    expect(result).toMatchObject({
      meetingContext: "Discuss launch",
      serverContext: "Server context",
      channelContext: "Channel context",
    });
    expect(result.dictionaryEntries).toHaveLength(1);
    expect(result.dictionaryBudgets).toEqual({
      maxEntries: 3,
      maxCharsTranscription: 200,
      maxCharsContext: 500,
    });
    expect(result.recentMeetings).toHaveLength(1);
    expect(mockedListRecentMeetings).toHaveBeenCalledWith(
      "guild-1",
      "voice-1",
      expect.any(Number),
    );
  });

  test("buildMeetingContext returns partial context on errors", async () => {
    mockedResolveConfigSnapshot.mockRejectedValue(new Error("boom"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const meeting = buildMeeting({ meetingContext: "Fallback" });
    const result = await buildMeetingContext(meeting, true);

    expect(result.meetingContext).toBe("Fallback");
    expect(result.dictionaryEntries).toHaveLength(1);
    expect(result.serverContext).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("formatContextForPrompt includes dictionary and memory for notes only", () => {
    const context = {
      serverContext: "Server context",
      channelContext: "Channel context",
      meetingContext: "Meeting context",
      dictionaryEntries: [
        {
          guildId: "guild-1",
          termKey: "chronote",
          term: "Chronote",
          definition: "Meeting notes bot",
          createdAt: "2025-01-01T00:00:00.000Z",
          createdBy: "user-1",
          updatedAt: "2025-01-01T00:00:00.000Z",
          updatedBy: "user-1",
        },
      ] as DictionaryEntry[],
      dictionaryBudgets: {
        maxEntries: 5,
        maxCharsTranscription: 200,
        maxCharsContext: 200,
      },
      recentMeetings: [
        buildHistory({
          notes: "Recap with decisions",
          context: "Prior context",
        }),
      ],
    };

    const notesContext = formatContextForPrompt(context, "notes");
    expect(notesContext).toContain("**Server Context:** Server context");
    expect(notesContext).toContain("**Channel Context:** Channel context");
    expect(notesContext).toContain("**Meeting Context:** Meeting context");
    expect(notesContext).toContain("**Dictionary:**");
    expect(notesContext).toContain("- Chronote: Meeting notes bot");
    expect(notesContext).toContain("Previous Meetings in This Channel");

    const transcriptionContext = formatContextForPrompt(
      context,
      "transcription",
    );
    expect(transcriptionContext).toContain("**Dictionary:**");
    expect(transcriptionContext).not.toContain(
      "Previous Meetings in This Channel",
    );

    const imageContext = formatContextForPrompt(context, "image");
    expect(imageContext).not.toContain("**Dictionary:**");
  });
});
