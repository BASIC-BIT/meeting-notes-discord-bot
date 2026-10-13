import { notifyRecordingLimit } from "./services/recordingLimitService";
import { MeetingData, MeetingSetup } from "./types/meeting-data";
import {
  ButtonInteraction,
  Guild,
  TextChannel,
  User,
  VoiceBasedChannel,
} from "discord.js";
import { NoSubscriberBehavior, createAudioPlayer } from "@discordjs/voice";
import type { SessionReservation } from "./types/deploymentControl";
import {
  attachMeetingReservation,
  getReservationSignal,
  tryAcquireMeetingLease,
  unwindSessionInitialization,
  releaseSessionReservation,
} from "./services/activeMeetingLeaseService";
import {
  runOwnedMeetingFinalization,
  assertMeetingFinalizationActive,
} from "./services/meetingFinalizationService";
import {
  joinOwnedVoiceSession,
  settleOwnedVoiceSession,
} from "./services/guildVoiceOperationService";
import { saveMeetingStartToDatabase } from "./commands/saveMeetingHistory";
import { AudioSnippet } from "./types/audio";
import {
  openOutputFile,
  closeFailedInitializationOutput,
  subscribeToUserVoice,
  userStartTalking,
  userStopTalking,
} from "./audio";
import {
  MAXIMUM_MEETING_DURATION,
  MAXIMUM_MEETING_DURATION_PRETTY,
} from "./constants";
import { v4 as uuidv4 } from "uuid";
import { ChatEntry } from "./types/chat";
import {
  buildParticipantSnapshot,
  formatUserMention,
  fromMember,
  fromUser,
} from "./utils/participants";
import { config } from "./services/configService";
import { resolveMeetingRuntimeConfig } from "./services/meetingConfigService";
import {
  getSnapshotBoolean,
  getSnapshotString,
  resolveConfigSnapshot,
} from "./services/unifiedConfigService";
import { listDictionaryEntriesService } from "./services/dictionaryService";
import { createTtsQueue } from "./ttsQueue";
import { maybeSpeakChatMessage } from "./chatTts";
import { CONFIG_KEYS } from "./config/keys";
import {
  MEETING_END_REASONS,
  MEETING_START_REASONS,
  type AutoRecordRule,
  type MeetingStartReason,
} from "./types/meetingLifecycle";
import { meetingsStarted } from "./metrics";
import { captureEvent } from "./services/analyticsService";
import type { ConfigTier } from "./config/types";
import type { ChatTtsSpeakerPrefixMode } from "./utils/ttsText";
import { DEFAULT_CHAT_TTS_SPEAKER_PREFIX_MODE as DEFAULT_PREFIX_MODE } from "./utils/ttsText";
import { resolveMeetingActorId } from "./utils/meetingLifecycle";

const meetings = new Map<string, MeetingData>();
const meetingInitializations = new Map<string, Promise<MeetingData>>();

// Since the bot can't be in multiple channels at once, we can just track a single meeting per guild, that's good enough.
// This actually solves a separate issue of having to track meeting by both voice channel and text channel

export function getMeeting(guildId: string) {
  return meetings.get(guildId);
}

export function hasMeeting(guildId: string) {
  return meetings.has(guildId);
}

export function addMeeting(meeting: MeetingData) {
  meetings.set(meeting.guildId, meeting);
}

export function deleteMeeting(guildId: string) {
  const meeting = meetings.get(guildId);
  if (meeting?.leaseHeartbeatTimer) {
    clearInterval(meeting.leaseHeartbeatTimer);
    meeting.leaseHeartbeatTimer = undefined;
  }
  if (meeting?.ttsOnlyIdleTimer) {
    clearTimeout(meeting.ttsOnlyIdleTimer);
    meeting.ttsOnlyIdleTimer = undefined;
  }
  meetings.delete(guildId);
}

export function getAllMeetings(): MeetingData[] {
  return Array.from(meetings.values());
}

const meetingSetups = new Map<string, MeetingSetup>();

export function getMeetingSetup(key: string) {
  return meetingSetups.get(key);
}
export function deleteMeetingSetup(key: string) {
  return meetingSetups.delete(key);
}

export interface MeetingInitOptions {
  meetingId?: string;
  reservedAt?: number;
  suppressionCheck?: { channelId: string; expectedVersion?: number };
  assertStartAllowed?: () => Promise<void>;
  startSignal?: AbortSignal;
  sessionMode?: "meeting" | "tts_only";
  captureAudio?: boolean;
  recordBotAudio?: boolean;
  storeChatLog?: boolean;
  leaseOwnerInstanceId?: string;
  voiceChannel: VoiceBasedChannel;
  textChannel: TextChannel;
  guild: Guild;
  creator: User;
  transcribeMeeting: boolean;
  generateNotes: boolean;
  meetingContext?: string;
  initialInteraction?: ButtonInteraction;
  isAutoRecording?: boolean;
  startReason?: MeetingStartReason;
  startTriggeredByUserId?: string;
  autoRecordRule?: AutoRecordRule;
  onTimeout?: (meeting: MeetingData) => void;
  tags?: string[];
  liveVoiceEnabled?: boolean;
  liveVoiceCommandsEnabled?: boolean;
  liveVoiceTtsVoice?: string;
  chatTtsEnabled?: boolean;
  chatTtsVoice?: string;
  chatTtsSpeakerPrefixMode?: ChatTtsSpeakerPrefixMode;
  maxMeetingDurationMs?: number;
  maxMeetingDurationPretty?: string;
  subscriptionTier?: ConfigTier;
  onEndMeeting?: (meeting: MeetingData) => Promise<void> | void;
}

const DISCORD_NICKNAME_MAX_LENGTH = 32;

function buildVoiceSessionNickname(displayName: string, suffix: string) {
  const trimmedName = displayName.trim();
  const trimmedSuffix = suffix.trim();
  if (!trimmedName || !trimmedSuffix) return undefined;
  if (trimmedName.endsWith(trimmedSuffix)) {
    return trimmedName.slice(0, DISCORD_NICKNAME_MAX_LENGTH);
  }

  const separator = " ";
  const maxNameLength =
    DISCORD_NICKNAME_MAX_LENGTH - trimmedSuffix.length - separator.length;
  if (maxNameLength <= 0) {
    return trimmedSuffix.slice(0, DISCORD_NICKNAME_MAX_LENGTH);
  }

  const baseName = trimmedName.slice(0, maxNameLength).trimEnd();
  return `${baseName}${separator}${trimmedSuffix}`.slice(
    0,
    DISCORD_NICKNAME_MAX_LENGTH,
  );
}

async function applyVoiceSessionNickname(meeting: MeetingData) {
  try {
    const snapshot = await resolveConfigSnapshot({
      guildId: meeting.guildId,
      channelId: meeting.voiceChannel.id,
      tier: meeting.subscriptionTier,
    });
    const enabled = getSnapshotBoolean(
      snapshot,
      CONFIG_KEYS.chatTts.statusNicknameEnabled,
    );
    if (!enabled) return;

    const nicknameKey =
      meeting.sessionMode === "tts_only"
        ? CONFIG_KEYS.chatTts.statusNicknameTtsOnly
        : CONFIG_KEYS.chatTts.statusNicknameRecording;
    const nicknameSuffix = getSnapshotString(snapshot, nicknameKey, {
      trim: true,
    });
    const botMember = meeting.guild.members.me;
    if (!nicknameSuffix || !botMember) return;

    const nextNickname = buildVoiceSessionNickname(
      botMember.displayName,
      nicknameSuffix,
    );
    if (!nextNickname) return;
    if (botMember.nickname === nextNickname) return;

    meeting.botNicknameBeforeSession = botMember.nickname ?? null;
    await botMember.setNickname(nextNickname);
    meeting.botNicknameChanged = true;
  } catch (error) {
    console.warn("Failed to update bot session nickname.", error);
  }
}

export async function restoreVoiceSessionNickname(meeting: MeetingData) {
  if (!meeting.botNicknameChanged) return;
  try {
    const botMember = meeting.guild.members.me;
    if (!botMember) return;
    await botMember.setNickname(meeting.botNicknameBeforeSession ?? null);
    meeting.botNicknameChanged = false;
  } catch (error) {
    console.warn("Failed to restore bot session nickname.", error);
  }
}

function formatIdleTimeoutDuration(timeoutMs: number) {
  const totalSeconds = Math.max(Math.round(timeoutMs / 1000), 1);
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
  }
  const totalMinutes = Math.max(Math.round(totalSeconds / 60), 1);
  return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
}

function clearTtsOnlyIdleTimeout(meeting: MeetingData) {
  if (!meeting.ttsOnlyIdleTimer) return;
  clearTimeout(meeting.ttsOnlyIdleTimer);
  meeting.ttsOnlyIdleTimer = undefined;
}

export function resetTtsOnlyIdleTimeout(meeting: MeetingData) {
  clearTtsOnlyIdleTimeout(meeting);
  const timeoutMs = config.chatTts.ttsOnlyIdleTimeoutMs ?? 0;
  if (
    meeting.sessionMode !== "tts_only" ||
    meeting.finishing ||
    meeting.finished ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return;
  }

  meeting.ttsOnlyIdleTimer = setTimeout(() => {
    void (async () => {
      if (
        meeting.finishing ||
        meeting.finished ||
        meetings.get(meeting.guildId) !== meeting
      ) {
        return;
      }
      await endTtsOnlySession(meeting, async () => {
        await Promise.resolve(
          meeting.textChannel.send(
            `TTS-only session ended after ${formatIdleTimeoutDuration(timeoutMs)} without speech activity. No recording or transcription was active.`,
          ),
        ).catch((error) => {
          console.warn("Failed to send TTS-only idle timeout notice.", error);
        });
      });
    })().catch((error) => {
      console.warn("TTS-only idle finalization remains unresolved.", error);
    });
  }, timeoutMs);
}

export function endTtsOnlySession(
  meeting: MeetingData,
  ancillary?: () => Promise<void>,
): Promise<void> {
  return runOwnedMeetingFinalization(meeting, () =>
    finalizeTtsOnlySession(meeting, ancillary),
  );
}

async function finalizeTtsOnlySession(
  meeting: MeetingData,
  ancillary?: () => Promise<void>,
): Promise<void> {
  if (meeting.timeoutTimer) {
    clearTimeout(meeting.timeoutTimer);
    meeting.timeoutTimer = undefined;
  }
  clearTtsOnlyIdleTimeout(meeting);
  meeting.finishing = true;
  meeting.endTime = new Date();
  meeting.ttsQueue?.stopAndClear();
  try {
    assertMeetingFinalizationActive(meeting);
    if (
      meeting.reservation &&
      (await settleOwnedVoiceSession(meeting.reservation)) !== "settled"
    )
      throw new Error("TTS voice ownership remains unresolved");
    assertMeetingFinalizationActive(meeting);
    await restoreVoiceSessionNickname(meeting);
    assertMeetingFinalizationActive(meeting);
    await ancillary?.();
    assertMeetingFinalizationActive(meeting);
    if (meeting.finalization) meeting.finalization.disposition = "durable";
    if (
      meeting.reservation &&
      !(await releaseSessionReservation(meeting.reservation))
    )
      throw new Error("TTS voice ownership remains unresolved");
    assertMeetingFinalizationActive(meeting);
  } catch (error) {
    if (meeting.finalization) meeting.finalization.disposition = "unresolved";
    throw error;
  }
  meeting.setFinished();
  meeting.finished = true;
  deleteMeeting(meeting.guildId);
}

/**
 * Initializes a new meeting with voice recording and chat logging.
 * This is the core function used by both manual and auto-recording features.
 *
 * @param options - Configuration options for the meeting
 * @returns The initialized MeetingData object
 * @throws Error if voice connection fails or if meeting setup encounters issues
 */
export function initializeMeeting(
  options: MeetingInitOptions,
): Promise<MeetingData> {
  const meetingId = options.meetingId ?? uuidv4();
  const key = `${options.guild.id}:${meetingId}`;
  const pending = meetingInitializations.get(key);
  if (pending) return pending;
  const existing = getMeeting(options.guild.id);
  if (existing?.meetingId === meetingId && !existing.finished)
    return Promise.resolve(existing);
  const initialization = initializeNewMeeting({ ...options, meetingId });
  meetingInitializations.set(key, initialization);
  void initialization.then(
    () => meetingInitializations.delete(key),
    () => meetingInitializations.delete(key),
  );
  return initialization;
}
async function initializeNewMeeting(
  options: MeetingInitOptions & { meetingId: string },
): Promise<MeetingData> {
  const reservedAt = options.reservedAt ?? Date.now();
  const meetingId = options.meetingId;
  const timestamp = new Date(reservedAt).toISOString();
  const shared = {
    assertStartAllowed: options.assertStartAllowed,
    startSignal: options.startSignal,
    guildId: options.guild.id,
    meetingId,
    voiceChannelId: options.voiceChannel.id,
    voiceChannelName: options.voiceChannel.name,
    textChannelId: options.textChannel.id,
    isAutoRecording: options.isAutoRecording ?? false,
    startReason: options.startReason,
    startTriggeredByUserId: options.startTriggeredByUserId,
    autoRecordRule: options.autoRecordRule,
    reservedAt,
  };
  const input =
    options.sessionMode === "tts_only"
      ? {
          ...shared,
          sessionMode: "tts_only" as const,
          suppression: options.suppressionCheck,
        }
      : {
          ...shared,
          sessionMode: "meeting" as const,
          suppression:
            options.suppressionCheck ??
            (options.isAutoRecording
              ? { channelId: options.voiceChannel.id }
              : undefined),
          history: {
            guildId: options.guild.id,
            channelId_timestamp: `${options.voiceChannel.id}#${timestamp}`,
            meetingId,
            channelId: options.voiceChannel.id,
            textChannelId: options.textChannel.id,
            timestamp,
            participants: [],
            duration: 0,
            transcribeMeeting: options.transcribeMeeting,
            generateNotes: options.generateNotes,
            meetingCreatorId: options.creator.id,
            isAutoRecording: options.isAutoRecording ?? false,
            context: options.meetingContext,
            tags: options.tags,
            startReason: options.startReason,
            startTriggeredByUserId: options.startTriggeredByUserId,
            autoRecordRule: options.autoRecordRule,
          },
        };
  const admission = await tryAcquireMeetingLease(input);
  if (admission.kind === "blocked")
    throw new Error(`Voice session admission blocked: ${admission.reason}`);
  const initialization: { meeting?: MeetingData; cleanup: Array<() => void> } =
    { cleanup: [] };
  try {
    options.startSignal?.throwIfAborted();
    const meeting = await initializeReservedMeeting({
      ...options,
      meetingId,
      reservation: admission.reservation,
      initialization,
    });
    options.startSignal?.throwIfAborted();
    await saveMeetingStartToDatabase(meeting);
    return meeting;
  } catch (error) {
    const cleanup = disposeFailedInitialization(initialization);
    await unwindSessionInitialization(admission.reservation, cleanup);
    throw error;
  }
}

async function disposeFailedInitialization(initialization: {
  meeting?: MeetingData;
  cleanup: Array<() => void>;
}): Promise<boolean> {
  const meeting = initialization.meeting;
  if (!meeting) return true;
  meeting.finishing = true;
  meeting.finished = true;
  const closeAudio = meeting.captureAudio || meeting.recordBotAudio;
  meeting.captureAudio = false;
  meeting.recordBotAudio = false;
  meeting.ttsQueue?.stopAndClear();
  for (const cleanup of initialization.cleanup) cleanup();
  if (meeting.timeoutTimer) clearTimeout(meeting.timeoutTimer);
  if (getMeeting(meeting.guildId) === meeting) deleteMeeting(meeting.guildId);
  meeting.setFinished();
  return closeAudio ? closeFailedInitializationOutput(meeting) : true;
}

async function initializeReservedMeeting(
  options: MeetingInitOptions & {
    reservation: SessionReservation;
    initialization: { meeting?: MeetingData; cleanup: Array<() => void> };
  },
): Promise<MeetingData> {
  const {
    meetingId,
    sessionMode = "meeting",
    captureAudio = sessionMode === "meeting",
    recordBotAudio = captureAudio,
    storeChatLog = sessionMode === "meeting",
    voiceChannel,
    textChannel,
    guild,
    creator,
    transcribeMeeting,
    generateNotes,
    meetingContext,
    initialInteraction,
    isAutoRecording = false,
    startReason,
    startTriggeredByUserId,
    autoRecordRule,
    onTimeout,
    tags,
    liveVoiceEnabled: liveVoiceOverride,
    liveVoiceCommandsEnabled: liveVoiceCommandsOverride,
    liveVoiceTtsVoice,
    chatTtsEnabled: chatTtsOverride,
    chatTtsVoice,
    chatTtsSpeakerPrefixMode = DEFAULT_PREFIX_MODE,
    maxMeetingDurationMs,
    maxMeetingDurationPretty,
    subscriptionTier,
    onEndMeeting,
  } = options;
  const resolvedStartReason =
    startReason ??
    (isAutoRecording
      ? MEETING_START_REASONS.AUTO_RECORD_CHANNEL
      : MEETING_START_REASONS.MANUAL_COMMAND);
  const canCaptureAudio = captureAudio && sessionMode === "meeting";

  const reservationSignal = getReservationSignal(options.reservation);
  const signal = options.startSignal
    ? AbortSignal.any([reservationSignal, options.startSignal])
    : reservationSignal;
  signal.throwIfAborted();
  // The reservation and its heartbeat exist before the SDK can issue a join.
  let connection;
  try {
    connection = await joinOwnedVoiceSession(options.reservation, {
      voiceChannel,
      guild,
      captureAudio: canCaptureAudio,
      signal,
    });
  } catch (error) {
    console.error("Failed to join voice channel:", error);
    throw new Error(
      `Failed to join voice channel: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  signal.throwIfAborted();
  const receiver = connection.receiver;
  const attendance: Set<string> = new Set<string>();
  const liveVoiceEnabled =
    canCaptureAudio &&
    config.liveVoice.mode === "tts_gate" &&
    liveVoiceOverride !== false;
  const liveVoiceCommandsEnabled =
    canCaptureAudio &&
    config.liveVoice.mode === "tts_gate" &&
    liveVoiceCommandsOverride === true;
  const chatTtsEnabled = chatTtsOverride ?? false;
  const botAudioEnabled =
    liveVoiceEnabled || chatTtsEnabled || liveVoiceCommandsEnabled;
  const liveAudioPlayer = botAudioEnabled
    ? createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      })
    : undefined;

  if (liveAudioPlayer) {
    connection.subscribe(liveAudioPlayer);
  }

  let setFinished: ((val?: void) => void) | undefined = undefined;
  const isFinished = new Promise<void>((resolve) => {
    setFinished = resolve;
  });

  const meeting: MeetingData = {
    reservation: options.reservation,
    meetingId: meetingId ?? uuidv4(),
    sessionMode,
    captureAudio: canCaptureAudio,
    recordBotAudio,
    storeChatLog,
    chatLog: [],
    attendance,
    connection,
    textChannel,
    audioData: {
      audioFiles: [],
      currentSnippets: new Map<string, AudioSnippet>(),
    },
    voiceChannel,
    guildId: guild.id,
    channelId: textChannel.id,
    startTime: new Date(options.reservation.reservedAt),
    creator,
    liveAudioPlayer,
    liveVoiceEnabled,
    liveVoiceCommandsEnabled,
    liveVoiceTtsVoice,
    chatTtsEnabled,
    chatTtsVoice,
    chatTtsSpeakerPrefixMode,
    chatTtsUserSettings: new Map(),
    isFinished,
    setFinished: () => setFinished && setFinished(),
    finishing: false,
    finished: false,
    guild,
    initialInteraction,
    transcribeMeeting,
    generateNotes,
    meetingContext,
    onEndMeeting: onEndMeeting ?? onTimeout,
    isAutoRecording,
    startReason: resolvedStartReason,
    startTriggeredByUserId,
    autoRecordRule,
    participants: new Map(),
    tags,
    subscriptionTier,
    leaseOwnerInstanceId: options.reservation.ownerInstanceId,
  };
  options.initialization.meeting = meeting;
  attachMeetingReservation(meeting, options.reservation);

  if (meeting.sessionMode === "tts_only") {
    meeting.resetTtsOnlyIdleTimer = () => resetTtsOnlyIdleTimeout(meeting);
  }

  if (liveAudioPlayer) {
    meeting.ttsQueue = createTtsQueue(meeting, liveAudioPlayer);
  }

  if (meeting.captureAudio || meeting.recordBotAudio) {
    openOutputFile(meeting);
  }

  // Set up error handling for the connection
  connection.on("error", (error) => {
    console.error("Voice connection error:", error);
    textChannel.send(
      `There was an error trying to join the voice channel${isAutoRecording ? " for auto-recording" : ""}.`,
    );
  });

  // Snapshot participants for initial members
  await Promise.all(
    voiceChannel.members.map(async (member) => {
      const participant = await buildParticipantSnapshot(
        voiceChannel.guild,
        member.user.id,
      );
      if (participant) {
        meeting.participants.set(member.user.id, participant);
        attendance.add(formatUserMention(member.user.id));
      }
    }),
  );

  signal.throwIfAborted();
  if (meeting.captureAudio) {
    await Promise.all(
      voiceChannel.members.map((member) =>
        subscribeToUserVoice(meeting, member.user.id),
      ),
    );

    receiver.speaking.on("start", (userId) => {
      userStartTalking(meeting, userId);
    });

    receiver.speaking.on("end", (userId) => {
      userStopTalking(meeting, userId);
    });
  }

  if (meeting.storeChatLog || meeting.chatTtsEnabled) {
    const collector = voiceChannel.createMessageCollector();
    options.initialization.cleanup.push(() => collector.stop());
    collector.on("collect", (message) => {
      if (meeting.finishing || meeting.finished) return;
      if (message.author.bot) return;

      const participant =
        meeting.participants.get(message.author.id) ??
        (message.member
          ? fromMember(message.member)
          : fromUser(message.author));

      meeting.participants.set(message.author.id, participant);

      const attachments =
        message.attachments.size > 0
          ? Array.from(message.attachments.values()).map((attachment) => ({
              id: attachment.id,
              name: attachment.name ?? "attachment",
              size: attachment.size,
              url: attachment.url,
              proxyUrl: attachment.proxyURL,
              contentType: attachment.contentType ?? undefined,
              width: attachment.width ?? undefined,
              height: attachment.height ?? undefined,
              durationSeconds: attachment.duration ?? undefined,
              description: attachment.description ?? undefined,
              ephemeral: attachment.ephemeral ?? undefined,
            }))
          : undefined;

      const entry: ChatEntry = {
        type: "message",
        source: "chat",
        user: participant,
        channelId: message.channelId,
        content: message.content,
        attachments,
        messageId: message.id,
        timestamp: new Date(message.createdTimestamp).toISOString(),
      };

      if (meeting.storeChatLog) {
        meeting.chatLog.push(entry);
        meeting.attendance.add(formatUserMention(message.author.id));
      }

      void maybeSpeakChatMessage(meeting, message, entry);
    });
  }

  signal.throwIfAborted();
  // Add meeting to the global map
  addMeeting(meeting);
  if (meeting.sessionMode === "meeting") {
    meetingsStarted.inc();
    captureEvent("meeting_started", {
      userId: resolveMeetingActorId(meeting),
      guildId: meeting.guildId,
      properties: {
        trigger: meeting.startReason,
        surface: "discord",
        is_auto_recording: meeting.isAutoRecording,
      },
    });
  }

  try {
    meeting.runtimeConfig = await resolveMeetingRuntimeConfig({
      guildId: meeting.guildId,
      channelId: meeting.voiceChannel.id,
      userId: meeting.creator.id,
      tier: subscriptionTier,
    });
  } catch (error) {
    console.warn("Failed to resolve meeting runtime config:", error);
  }

  await applyVoiceSessionNickname(meeting);
  resetTtsOnlyIdleTimeout(meeting);

  if (meeting.captureAudio) {
    try {
      meeting.dictionaryEntries = await listDictionaryEntriesService(
        meeting.guildId,
      );
    } catch (error) {
      console.warn("Failed to load dictionary entries:", error);
    }
  }

  signal.throwIfAborted();

  // Set a timer to automatically end the meeting after the specified duration
  if (onTimeout) {
    const durationLimitMs = maxMeetingDurationMs ?? MAXIMUM_MEETING_DURATION;
    const durationPretty =
      maxMeetingDurationPretty ?? MAXIMUM_MEETING_DURATION_PRETTY;
    meeting.timeoutTimer = setTimeout(() => {
      const state: NonNullable<MeetingData["recordingLimitNotice"]> = {};
      meeting.recordingLimitNotice = state;
      meeting.endReason = MEETING_END_REASONS.TIMEOUT;
      onTimeout(meeting);
      state.pending = notifyRecordingLimit(
        {
          guildId: meeting.guildId,
          userId: resolveMeetingActorId(meeting),
          limitType: "meeting_duration",
          limitSurface: "duration_stop",
          outcome: "ended_session",
          limitMinutes: durationLimitMs / 60000,
          message: `Recording stopped at the ${durationPretty} limit for this meeting. Your recording will finish processing as usual.`,
        },
        textChannel,
        state,
      ).catch(() => undefined);
    }, durationLimitMs);
  }

  return meeting;
}
