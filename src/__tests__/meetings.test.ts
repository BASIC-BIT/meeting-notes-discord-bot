/** @jest-environment node */
jest.mock("../services/recordingLimitService", () => ({
  notifyRecordingLimit: jest.fn(),
}));
jest.mock("../services/activeMeetingLeaseService", () => ({
  tryAcquireMeetingLease: jest.fn(async (input) => ({
    kind: "admitted",
    reservation: {
      guildId: input.guildId,
      meetingId: input.meetingId,
      sessionMode: input.sessionMode,
      ownerInstanceId: "fixture",
      executionVersion: 1,
      voiceOperationAttemptId: "attempt",
      reservedAt: input.reservedAt,
      historyKey: input.history && {
        guildId: input.guildId,
        channelId_timestamp: input.history.channelId_timestamp,
      },
      workHandle: { settle: jest.fn(), transition: jest.fn() },
    },
  })),
  getReservationSignal: jest.fn(() => new AbortController().signal),
  attachMeetingReservation: jest.fn(),
  unwindSessionInitialization: jest.fn(),
  releaseSessionReservation: jest.fn(async () => true),
}));
jest.mock("../commands/saveMeetingHistory", () => ({
  saveMeetingStartToDatabase: jest.fn(),
}));
jest.mock("../services/guildVoiceOperationService", () => ({
  settleOwnedVoiceSession: jest.fn(async () => "settled"),
  joinOwnedVoiceSession: jest.fn(async (_reservation, options) =>
    jest.requireMock("@discordjs/voice").joinVoiceChannel({
      channelId: options.voiceChannel.id,
      guildId: options.guild.id,
      adapterCreator: options.guild.voiceAdapterCreator,
      selfDeaf: !options.captureAudio,
      selfMute: false,
    }),
  ),
}));
import {
  releaseSessionReservation,
  tryAcquireMeetingLease,
  unwindSessionInitialization,
} from "../services/activeMeetingLeaseService";
import { notifyRecordingLimit } from "../services/recordingLimitService";
import { joinOwnedVoiceSession } from "../services/guildVoiceOperationService";
jest.mock("@discordjs/voice", () => ({
  NoSubscriberBehavior: { Pause: "pause" },
  createAudioPlayer: jest.fn(() => ({ state: { status: "idle" } })),
  joinVoiceChannel: jest.fn(() => ({
    receiver: { speaking: { on: jest.fn() } },
    subscribe: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock("../audio", () => ({
  openOutputFile: jest.fn(),
  closeFailedInitializationOutput: jest.fn(async () => true),
  subscribeToUserVoice: jest.fn(),
  userStartTalking: jest.fn(),
  userStopTalking: jest.fn(),
}));

const mockConfig = {
  analytics: { posthogKey: "" },
  liveVoice: { mode: "tts_gate" },
  chatTts: { queueLimit: 10, ttsOnlyIdleTimeoutMs: 0 },
};

jest.mock("../services/configService", () => ({
  config: mockConfig,
}));

jest.mock("../services/meetingConfigService", () => ({
  resolveMeetingRuntimeConfig: jest.fn(async () => ({})),
}));

jest.mock("../services/unifiedConfigService", () => ({
  getSnapshotBoolean: jest.fn(() => false),
  getSnapshotString: jest.fn(() => undefined),
  resolveConfigSnapshot: jest.fn(async () => ({ values: {} })),
}));

jest.mock("../services/dictionaryService", () => ({
  listDictionaryEntriesService: jest.fn(async () => []),
}));

jest.mock("../ttsQueue", () => ({
  createTtsQueue: jest.fn(() => ({
    enqueue: jest.fn(() => true),
    playCueIfIdle: jest.fn(() => false),
    stopAndClear: jest.fn(),
    size: jest.fn(() => 0),
  })),
}));

jest.mock("../chatTts", () => ({
  maybeSpeakChatMessage: jest.fn(),
}));

jest.mock("../utils/participants", () => ({
  buildParticipantSnapshot: jest.fn(
    async (_guild: unknown, userId: string) => ({
      id: userId,
      username: `user-${userId}`,
    }),
  ),
  formatUserMention: jest.fn((userId: string) => `<@${userId}>`),
  fromMember: jest.fn((member: { user: { id: string; username: string } }) => ({
    id: member.user.id,
    username: member.user.username,
  })),
  fromUser: jest.fn((user: { id: string; username: string }) => ({
    id: user.id,
    username: user.username,
  })),
}));

import { createAudioPlayer, joinVoiceChannel } from "@discordjs/voice";
import {
  openOutputFile,
  closeFailedInitializationOutput,
  subscribeToUserVoice,
  userStartTalking,
  userStopTalking,
} from "../audio";
import { listDictionaryEntriesService } from "../services/dictionaryService";
import {
  getSnapshotBoolean,
  getSnapshotString,
} from "../services/unifiedConfigService";
import { createTtsQueue } from "../ttsQueue";
import {
  deleteMeeting,
  initializeMeeting,
  restoreVoiceSessionNickname,
  endTtsOnlySession,
  getMeeting,
} from "../meetings";
import type { Guild, TextChannel, User, VoiceBasedChannel } from "discord.js";

const buildMembers = (members: Array<{ user: { id: string } }> = []) => ({
  map: <T>(callback: (member: { user: { id: string } }) => T) =>
    members.map(callback),
  has: jest.fn(() => false),
  size: members.length,
});

const buildBotMember = (
  displayName = "Meeting Notes Bot",
  nickname: string | null = null,
) => {
  const originalDisplayName = displayName;
  const botMember = {
    displayName,
    nickname: nickname as string | null,
    setNickname: jest.fn(async (nextNickname: string | null) => {
      botMember.nickname = nextNickname;
      botMember.displayName = nextNickname ?? originalDisplayName;
    }),
  };
  return botMember;
};

const buildMeetingOptions = (botMember: unknown = null) => {
  const guild = {
    id: "guild-1",
    voiceAdapterCreator: {},
    members: { me: botMember },
  } as unknown as Guild;
  const voiceChannel = {
    id: "voice-1",
    name: "Voice",
    guild,
    members: buildMembers([{ user: { id: "user-1" } }]),
    createMessageCollector: jest.fn(() => ({ on: jest.fn(), stop: jest.fn() })),
  } as unknown as VoiceBasedChannel;
  const textChannel = {
    id: "text-1",
    send: jest.fn(),
  } as unknown as TextChannel;
  const creator = { id: "creator-1" } as User;

  return { guild, voiceChannel, textChannel, creator };
};

describe("initializeMeeting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteMeeting("guild-1");
    mockConfig.chatTts.ttsOnlyIdleTimeoutMs = 0;
    jest.mocked(getSnapshotBoolean).mockReturnValue(false);
    jest.mocked(getSnapshotString).mockReturnValue(undefined);
  });

  it("TTS nickname restoration remains owned before release", async () => {
    const bot = buildBotMember();
    const meeting = await initializeMeeting({
      ...buildMeetingOptions(bot),
      sessionMode: "tts_only",
      transcribeMeeting: false,
      generateNotes: false,
    });
    meeting.botNicknameChanged = true;
    let finish!: () => void;
    bot.setNickname.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const ending = endTtsOnlySession(meeting);
    await Promise.resolve();
    await Promise.resolve();
    expect(releaseSessionReservation).not.toHaveBeenCalled();
    finish();
    await ending;
    expect(meeting.finished).toBe(true);
  });
  it("TTS idle notice remains owned before release", async () => {
    jest.useFakeTimers();
    mockConfig.chatTts.ttsOnlyIdleTimeoutMs = 1000;
    const options = buildMeetingOptions();
    let finish!: () => void;
    jest.mocked(options.textChannel.send).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {} as never;
    });
    const meeting = await initializeMeeting({
      ...options,
      sessionMode: "tts_only",
      transcribeMeeting: false,
      generateNotes: false,
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(options.textChannel.send).toHaveBeenCalled();
    expect(releaseSessionReservation).not.toHaveBeenCalled();
    expect(meeting.finished).toBe(false);
    finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(meeting.finished).toBe(true);
  });
  it("TTS idle release failure is observed and retains unresolved ownership", async () => {
    jest.useFakeTimers();
    mockConfig.chatTts.ttsOnlyIdleTimeoutMs = 1000;
    const warn = jest.spyOn(console, "warn");
    jest.mocked(releaseSessionReservation).mockResolvedValueOnce(false);
    const meeting = await initializeMeeting({
      ...buildMeetingOptions(),
      sessionMode: "tts_only",
      transcribeMeeting: false,
      generateNotes: false,
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledWith(
      "TTS-only idle finalization remains unresolved.",
      expect.any(Error),
    );
    expect(meeting.finalization?.disposition).toBe("unresolved");
    expect(meeting.finished).toBe(false);
    expect(getMeeting(meeting.guildId)).toBe(meeting);
    expect(meeting.reservation?.workHandle.settle).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it.each([
    "manual",
    "context_menu",
    "auto_channel",
    "auto_all",
    "remote",
    "tts_only",
  ])("%s does not join voice when shared admission is sealed", async (path) => {
    jest
      .mocked(tryAcquireMeetingLease)
      .mockResolvedValueOnce({ kind: "blocked", reason: "not_serving" });
    await expect(
      initializeMeeting({
        ...buildMeetingOptions(),
        transcribeMeeting: true,
        generateNotes: true,
        sessionMode: path === "tts_only" ? "tts_only" : "meeting",
        isAutoRecording: path.startsWith("auto"),
      }),
    ).rejects.toThrow("not_serving");
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });
  it.each(["reservation", "voice"] as const)(
    "a control fenced during held %s cannot begin capture",
    async (boundary) => {
      let release!: () => void;
      let enter!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        enter = resolve;
      });
      if (boundary === "reservation") {
        const reserve = jest
          .mocked(tryAcquireMeetingLease)
          .getMockImplementation()!;
        jest
          .mocked(tryAcquireMeetingLease)
          .mockImplementationOnce(async (input) => {
            enter();
            await held;
            return reserve(input);
          });
      } else {
        const join = jest
          .mocked(joinOwnedVoiceSession)
          .getMockImplementation()!;
        jest
          .mocked(joinOwnedVoiceSession)
          .mockImplementationOnce(async (...args) => {
            enter();
            await held;
            return join(...args);
          });
      }
      const controller = new AbortController();
      const initialization = initializeMeeting({
        ...buildMeetingOptions(),
        transcribeMeeting: true,
        generateNotes: true,
        startSignal: controller.signal,
      });
      await started;
      controller.abort(new Error("control claim lost"));
      release();
      await expect(initialization).rejects.toThrow("control claim lost");
      expect(openOutputFile).not.toHaveBeenCalled();
      expect(subscribeToUserVoice).not.toHaveBeenCalled();
      if (boundary === "reservation")
        expect(joinOwnedVoiceSession).not.toHaveBeenCalled();
      else
        expect(
          jest.mocked(joinOwnedVoiceSession).mock.calls[0][1].signal.aborted,
        ).toBe(true);
      expect(unwindSessionInitialization).toHaveBeenCalled();
    },
  );

  it("unwinds the owned reservation if initialization fails after joining", async () => {
    jest
      .mocked(subscribeToUserVoice)
      .mockRejectedValueOnce(new Error("fixture initialization failed"));
    await expect(
      initializeMeeting({
        ...buildMeetingOptions(),
        transcribeMeeting: true,
        generateNotes: true,
      }),
    ).rejects.toThrow("fixture initialization failed");
    expect(unwindSessionInitialization).toHaveBeenCalledWith(
      expect.objectContaining({ sessionMode: "meeting", executionVersion: 1 }),
      expect.any(Promise),
    );
  });
  it("output setup failure starts owned unwind without waiting for encoder cleanup", async () => {
    jest.mocked(openOutputFile).mockImplementationOnce(() => {
      throw new Error("fixture output setup failed");
    });
    jest
      .mocked(closeFailedInitializationOutput)
      .mockReturnValueOnce(new Promise(() => {}));
    await expect(
      initializeMeeting({
        ...buildMeetingOptions(),
        transcribeMeeting: true,
        generateNotes: true,
      }),
    ).rejects.toThrow("fixture output setup failed");
    expect(unwindSessionInitialization).toHaveBeenCalledWith(
      expect.objectContaining({ sessionMode: "meeting" }),
      expect.any(Promise),
    );
    const meeting = jest.mocked(openOutputFile).mock.calls[0][0];
    expect(meeting.captureStartedAt).toBeUndefined();
    expect(meeting.finished).toBe(true);
  });
  it("stable concurrent initialization retries share one reservation and one join", async () => {
    const options = {
      ...buildMeetingOptions(),
      meetingId: "stable-retry",
      reservedAt: 100,
      transcribeMeeting: true,
      generateNotes: true,
    };
    const first = initializeMeeting(options);
    const second = initializeMeeting(options);
    expect(second).toBe(first);
    expect(await second).toBe(await first);
    expect(tryAcquireMeetingLease).toHaveBeenCalledTimes(1);
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("ends at the captured cap before awaiting upgrade eligibility", async () => {
    jest.useFakeTimers();
    jest.mocked(notifyRecordingLimit).mockReturnValue(new Promise(() => {}));
    const options = buildMeetingOptions();
    const onTimeout = jest.fn(() => {
      expect(notifyRecordingLimit).not.toHaveBeenCalled();
    });
    const meeting = await initializeMeeting({
      ...options,
      transcribeMeeting: false,
      generateNotes: false,
      maxMeetingDurationMs: 90 * 60000,
      maxMeetingDurationPretty: "90 minutes",
      onTimeout,
    });
    jest.advanceTimersByTime(90 * 60000);
    expect(onTimeout).toHaveBeenCalledWith(meeting);
    expect(meeting.endReason).toBe("timeout");
    expect(notifyRecordingLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        limitType: "meeting_duration",
        limitSurface: "duration_stop",
        outcome: "ended_session",
        limitMinutes: 90,
        userId: "creator-1",
      }),
      options.textChannel,
      meeting.recordingLimitNotice,
    );
    expect(meeting.recordingLimitNotice?.pending).toBeDefined();
    expect(options.textChannel.send).not.toHaveBeenCalled();
    deleteMeeting(meeting.guildId);
  });

  it("does not create capture or recording plumbing for TTS-only sessions", async () => {
    const { guild, voiceChannel, textChannel, creator } = buildMeetingOptions();

    const meeting = await initializeMeeting({
      sessionMode: "tts_only",
      captureAudio: false,
      recordBotAudio: false,
      storeChatLog: false,
      guild,
      voiceChannel,
      textChannel,
      creator,
      transcribeMeeting: false,
      generateNotes: false,
      chatTtsEnabled: true,
    });

    expect(meeting.sessionMode).toBe("tts_only");
    expect(meeting.captureAudio).toBe(false);
    expect(meeting.recordBotAudio).toBe(false);
    expect(meeting.storeChatLog).toBe(false);
    expect(openOutputFile).not.toHaveBeenCalled();
    expect(subscribeToUserVoice).not.toHaveBeenCalled();
    expect(userStartTalking).not.toHaveBeenCalled();
    expect(userStopTalking).not.toHaveBeenCalled();
    expect(listDictionaryEntriesService).not.toHaveBeenCalled();
    expect(createAudioPlayer).toHaveBeenCalled();
    expect(createTtsQueue).toHaveBeenCalled();
    expect(joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ selfDeaf: true }),
    );
    const connection = jest.mocked(joinVoiceChannel).mock.results[0].value;
    expect(connection.receiver.speaking.on).not.toHaveBeenCalled();
    expect(connection.on).not.toHaveBeenCalledWith(
      "transitioned",
      expect.any(Function),
    );

    deleteMeeting(meeting.guildId);
  });

  it("appends the session status suffix to the current bot display name", async () => {
    const botMember = buildBotMember("Meeting Notes Bot");
    const { guild, voiceChannel, textChannel, creator } =
      buildMeetingOptions(botMember);
    jest.mocked(getSnapshotBoolean).mockReturnValue(true);
    jest.mocked(getSnapshotString).mockReturnValue("(TTS Only)");

    const meeting = await initializeMeeting({
      sessionMode: "tts_only",
      captureAudio: false,
      recordBotAudio: false,
      storeChatLog: false,
      guild,
      voiceChannel,
      textChannel,
      creator,
      transcribeMeeting: false,
      generateNotes: false,
      chatTtsEnabled: true,
    });

    expect(botMember.setNickname).toHaveBeenCalledWith(
      "Meeting Notes Bot (TTS Only)",
    );
    expect(meeting.botNicknameBeforeSession).toBeNull();

    await restoreVoiceSessionNickname(meeting);
    expect(botMember.setNickname).toHaveBeenLastCalledWith(null);

    deleteMeeting(meeting.guildId);
  });

  it("does not duplicate an existing session status suffix", async () => {
    const botMember = buildBotMember(
      "Meeting Notes Bot (TTS Only)",
      "Meeting Notes Bot (TTS Only)",
    );
    const { guild, voiceChannel, textChannel, creator } =
      buildMeetingOptions(botMember);
    jest.mocked(getSnapshotBoolean).mockReturnValue(true);
    jest.mocked(getSnapshotString).mockReturnValue("(TTS Only)");

    const meeting = await initializeMeeting({
      sessionMode: "tts_only",
      captureAudio: false,
      recordBotAudio: false,
      storeChatLog: false,
      guild,
      voiceChannel,
      textChannel,
      creator,
      transcribeMeeting: false,
      generateNotes: false,
      chatTtsEnabled: true,
    });

    expect(botMember.setNickname).not.toHaveBeenCalled();

    deleteMeeting(meeting.guildId);
  });

  it("ends a TTS-only session after inactivity", async () => {
    jest.useFakeTimers();
    mockConfig.chatTts.ttsOnlyIdleTimeoutMs = 1000;
    const { guild, voiceChannel, textChannel, creator } = buildMeetingOptions();

    const meeting = await initializeMeeting({
      sessionMode: "tts_only",
      captureAudio: false,
      recordBotAudio: false,
      storeChatLog: false,
      guild,
      voiceChannel,
      textChannel,
      creator,
      transcribeMeeting: false,
      generateNotes: false,
      chatTtsEnabled: true,
    });

    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(releaseSessionReservation).toHaveBeenCalledWith(meeting.reservation);
    expect(meeting.finished).toBe(true);
    expect(textChannel.send).toHaveBeenCalledWith(
      expect.stringContaining("after 1 second without speech activity"),
    );
  });

  it("resets the TTS-only inactivity timer when speech activity occurs", async () => {
    jest.useFakeTimers();
    mockConfig.chatTts.ttsOnlyIdleTimeoutMs = 1000;
    const { guild, voiceChannel, textChannel, creator } = buildMeetingOptions();

    const meeting = await initializeMeeting({
      sessionMode: "tts_only",
      captureAudio: false,
      recordBotAudio: false,
      storeChatLog: false,
      guild,
      voiceChannel,
      textChannel,
      creator,
      transcribeMeeting: false,
      generateNotes: false,
      chatTtsEnabled: true,
    });
    const connection = jest.mocked(joinVoiceChannel).mock.results[0].value;

    jest.advanceTimersByTime(999);
    meeting.resetTtsOnlyIdleTimer?.();
    jest.advanceTimersByTime(999);
    await Promise.resolve();

    expect(connection.disconnect).not.toHaveBeenCalled();
    expect(textChannel.send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(releaseSessionReservation).toHaveBeenCalledWith(meeting.reservation);
    expect(textChannel.send).toHaveBeenCalledWith(
      expect.stringContaining("after 1 second without speech activity"),
    );
  });

  it("keeps capture and recording plumbing for normal meetings", async () => {
    const { guild, voiceChannel, textChannel, creator } = buildMeetingOptions();

    const meeting = await initializeMeeting({
      guild,
      voiceChannel,
      textChannel,
      creator,
      transcribeMeeting: true,
      generateNotes: true,
      chatTtsEnabled: false,
    });

    expect(meeting.sessionMode).toBe("meeting");
    expect(meeting.captureAudio).toBe(true);
    expect(openOutputFile).toHaveBeenCalledWith(meeting);
    expect(subscribeToUserVoice).toHaveBeenCalledWith(meeting, "user-1");
    expect(listDictionaryEntriesService).toHaveBeenCalledWith("guild-1");
    expect(joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ selfDeaf: false }),
    );
    const connection = jest.mocked(joinVoiceChannel).mock.results[0].value;
    expect(connection.receiver.speaking.on).toHaveBeenCalledWith(
      "start",
      expect.any(Function),
    );
    expect(connection.receiver.speaking.on).toHaveBeenCalledWith(
      "end",
      expect.any(Function),
    );
    deleteMeeting(meeting.guildId);
  });
});
