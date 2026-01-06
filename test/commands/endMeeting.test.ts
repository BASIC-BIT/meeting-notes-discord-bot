import type { ButtonInteraction, Client } from "discord.js";
import type { MeetingData } from "../../src/types/meeting-data";
import {
  handleEndMeetingButton,
  handleEndMeetingOther,
} from "../../src/commands/endMeeting";
import { startProcessingSnippet } from "../../src/audio";
import { withMeetingEndTrace } from "../../src/observability/meetingTrace";
import { sendMeetingEndEmbedToChannel } from "../../src/embed";
import { evaluateAutoRecordCancellation } from "../../src/services/autoRecordCancellationService";
import {
  buildMixedAudio,
  closeOutputFile,
  splitAudioIntoChunks,
  stitchAudioSegments,
  waitForAudioOnlyFinishProcessing,
} from "../../src/audio";
import { uploadMeetingArtifacts } from "../../src/services/uploadService";
import { saveMeetingHistoryToDatabase } from "../../src/commands/saveMeetingHistory";
import { getGuildLimits } from "../../src/services/subscriptionService";
import { updateMeetingStatusService } from "../../src/services/meetingHistoryService";
import { getMeeting } from "../../src/meetings";
import { describeAutoRecordRule } from "../../src/utils/meetingLifecycle";

jest.mock("../../src/audio", () => ({
  buildMixedAudio: jest.fn(),
  cleanupAudioSegments: jest.fn(),
  closeOutputFile: jest.fn(),
  compileTranscriptions: jest.fn(),
  splitAudioIntoChunks: jest.fn(),
  stitchAudioSegments: jest.fn(),
  startProcessingSnippet: jest.fn(),
  waitForAudioOnlyFinishProcessing: jest.fn(),
  waitForFinishProcessing: jest.fn(),
}));
jest.mock("../../src/embed", () => ({
  sendMeetingEndEmbed: jest.fn(),
  sendMeetingEndEmbedToChannel: jest.fn(),
  sendTranscriptionFiles: jest.fn(),
}));
jest.mock("../../src/util", () => ({
  deleteDirectoryRecursively: jest.fn(),
  deleteIfExists: jest.fn(),
}));
jest.mock("../../src/commands/generateNotes", () => ({
  generateAndSendNotes: jest.fn(),
}));
jest.mock("../../src/commands/saveMeetingHistory", () => ({
  saveMeetingHistoryToDatabase: jest.fn(),
}));
jest.mock("../../src/services/meetingHistoryService", () => ({
  updateMeetingStatusService: jest.fn(),
}));
jest.mock("../../src/utils/chatLog", () => ({
  renderChatEntryLine: jest.fn().mockReturnValue(""),
}));
jest.mock("../../src/services/uploadService", () => ({
  uploadMeetingArtifacts: jest.fn(),
}));
jest.mock("../../src/services/subscriptionService", () => ({
  getGuildLimits: jest.fn(),
}));
jest.mock("../../src/audio/soundCues", () => ({
  stopThinkingCueLoop: jest.fn(),
}));
jest.mock("../../src/observability/meetingTrace", () => ({
  withMeetingEndTrace: jest.fn(),
  withMeetingEndStep: jest.fn(
    (_meeting: unknown, _name: string, run: () => unknown) => run(),
  ),
}));
jest.mock("../../src/services/autoRecordCancellationService", () => ({
  evaluateAutoRecordCancellation: jest.fn(),
}));
jest.mock("../../src/metrics", () => ({
  meetingsCancelled: { inc: jest.fn() },
}));
jest.mock("../../src/utils/meetingLifecycle", () => ({
  describeAutoRecordRule: jest.fn(),
}));
jest.mock("../../src/meetings", () => ({
  deleteMeeting: jest.fn(),
  getMeeting: jest.fn(),
  hasMeeting: jest.fn(),
}));
jest.mock("../../src/services/meetingUsageService", () => ({
  getNextAvailableAt: jest.fn(),
  getRollingUsageForGuild: jest.fn(),
  getRollingWindowMs: jest.fn(),
}));
jest.mock("../../src/utils/upgradePrompt", () => ({
  buildUpgradeTextOnly: jest.fn((content: string) => content),
}));
jest.mock("node:fs", () => ({
  mkdirSync: jest.fn(),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    rm: jest.fn().mockResolvedValue(undefined),
  },
  writeFileSync: jest.fn(),
}));

const mockedStartProcessingSnippet =
  startProcessingSnippet as jest.MockedFunction<typeof startProcessingSnippet>;
const mockedWithMeetingEndTrace = withMeetingEndTrace as jest.MockedFunction<
  typeof withMeetingEndTrace
>;
const mockedSendMeetingEndEmbedToChannel =
  sendMeetingEndEmbedToChannel as jest.MockedFunction<
    typeof sendMeetingEndEmbedToChannel
  >;
const mockedEvaluateAutoRecordCancellation =
  evaluateAutoRecordCancellation as jest.MockedFunction<
    typeof evaluateAutoRecordCancellation
  >;
const mockedBuildMixedAudio = buildMixedAudio as jest.MockedFunction<
  typeof buildMixedAudio
>;
const mockedStitchAudioSegments = stitchAudioSegments as jest.MockedFunction<
  typeof stitchAudioSegments
>;
const mockedCloseOutputFile = closeOutputFile as jest.MockedFunction<
  typeof closeOutputFile
>;
const mockedSplitAudioIntoChunks = splitAudioIntoChunks as jest.MockedFunction<
  typeof splitAudioIntoChunks
>;
const mockedWaitForAudioOnlyFinishProcessing =
  waitForAudioOnlyFinishProcessing as jest.MockedFunction<
    typeof waitForAudioOnlyFinishProcessing
  >;
const mockedUploadMeetingArtifacts =
  uploadMeetingArtifacts as jest.MockedFunction<typeof uploadMeetingArtifacts>;
const mockedSaveMeetingHistoryToDatabase =
  saveMeetingHistoryToDatabase as jest.MockedFunction<
    typeof saveMeetingHistoryToDatabase
  >;
const mockedGetGuildLimits = getGuildLimits as jest.MockedFunction<
  typeof getGuildLimits
>;
const mockedUpdateMeetingStatusService =
  updateMeetingStatusService as jest.MockedFunction<
    typeof updateMeetingStatusService
  >;
const mockedGetMeeting = getMeeting as jest.MockedFunction<typeof getMeeting>;
const mockedDescribeAutoRecordRule =
  describeAutoRecordRule as jest.MockedFunction<typeof describeAutoRecordRule>;

describe("handleEndMeetingOther", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStitchAudioSegments.mockResolvedValue(undefined);
  });

  it("flushes active snippets before disconnecting the voice connection", async () => {
    const events: string[] = [];
    mockedStartProcessingSnippet.mockImplementation(() => {
      events.push("flush");
    });
    mockedWithMeetingEndTrace.mockImplementation(async (_meeting, fn) => fn());
    mockedSendMeetingEndEmbedToChannel.mockResolvedValue(undefined);
    mockedEvaluateAutoRecordCancellation.mockResolvedValue({ cancel: false });
    mockedBuildMixedAudio.mockResolvedValue(undefined);
    mockedCloseOutputFile.mockResolvedValue(undefined);
    mockedSplitAudioIntoChunks.mockResolvedValue([
      { file: "chunk.mp3", start: 0, end: 0 },
    ]);
    mockedWaitForAudioOnlyFinishProcessing.mockResolvedValue(undefined);
    mockedUploadMeetingArtifacts.mockResolvedValue(undefined);
    mockedSaveMeetingHistoryToDatabase.mockResolvedValue(undefined);
    mockedGetGuildLimits.mockResolvedValue({ limits: {} } as never);
    mockedUpdateMeetingStatusService.mockResolvedValue(undefined);

    const connection = {
      disconnect: jest.fn(() => {
        events.push("disconnect");
      }),
      destroy: jest.fn(() => {
        events.push("destroy");
      }),
    };

    const meeting = {
      guildId: "guild-1",
      channelId: "text-1",
      meetingId: "meeting-1",
      voiceChannel: { id: "voice-1", name: "Voice" },
      textChannel: {
        send: jest.fn(),
        messages: { fetch: jest.fn() },
      },
      connection,
      chatLog: [],
      audioData: {
        audioFiles: [],
        currentSnippets: new Map([
          [
            "user-1",
            {
              userId: "user-1",
              timestamp: Date.now(),
              chunks: [Buffer.from("test")],
              fastRevision: 0,
              fastTranscribed: false,
            },
          ],
        ]),
        outputFileName: "recording.mp3",
      },
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: undefined,
      finishing: false,
      finished: false,
      transcribeMeeting: false,
      generateNotes: false,
      isAutoRecording: false,
      creator: { id: "user-1" },
      guild: { id: "guild-1", name: "Guild", members: { cache: new Map() } },
      ttsQueue: { stopAndClear: jest.fn() },
      setFinished: jest.fn(),
    } as unknown as MeetingData;

    await handleEndMeetingOther({} as Client, meeting);

    expect(events.indexOf("flush")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("flush")).toBeLessThan(events.indexOf("disconnect"));
    expect(events.indexOf("disconnect")).toBeLessThan(
      events.indexOf("destroy"),
    );
  });
});

describe("handleEndMeetingButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("clears the deferred reply when auto-recording is cancelled", async () => {
    mockedWithMeetingEndTrace.mockImplementation(async (_meeting, fn) => fn());
    mockedEvaluateAutoRecordCancellation.mockResolvedValue({
      cancel: true,
      reason: "No meaningful content detected.",
    });
    mockedWaitForAudioOnlyFinishProcessing.mockResolvedValue(undefined);
    mockedCloseOutputFile.mockResolvedValue(undefined);
    mockedDescribeAutoRecordRule.mockReturnValue(
      "Auto-record rule: test-channel",
    );

    const meeting = {
      guildId: "guild-1",
      channelId: "text-1",
      meetingId: "meeting-1",
      voiceChannel: { id: "voice-1", name: "Voice" },
      textChannel: {
        send: jest.fn().mockResolvedValue(undefined),
        messages: { fetch: jest.fn() },
      },
      connection: {
        disconnect: jest.fn(),
        destroy: jest.fn(),
      },
      chatLog: [],
      audioData: {
        audioFiles: [],
        currentSnippets: new Map(),
        outputFileName: "recording.mp3",
      },
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: undefined,
      finishing: false,
      finished: false,
      transcribeMeeting: false,
      generateNotes: false,
      isAutoRecording: true,
      creator: { id: "user-1" },
      guild: { id: "guild-1", members: { cache: new Map() } },
      ttsQueue: { stopAndClear: jest.fn() },
      setFinished: jest.fn(),
    } as unknown as MeetingData;

    mockedGetMeeting.mockReturnValue(meeting);

    const interaction = {
      guildId: "guild-1",
      user: { id: "user-1" },
      deferred: true,
      replied: false,
      deferReply: jest.fn().mockResolvedValue(undefined),
      deleteReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await handleEndMeetingButton({} as Client, interaction);

    expect(interaction.deleteReply).toHaveBeenCalled();
  });
});
