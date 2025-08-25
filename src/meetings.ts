import { MeetingData, MeetingSetup } from "./types/meeting-data";
import {
  ButtonInteraction,
  Guild,
  TextChannel,
  User,
  VoiceBasedChannel,
} from "discord.js";
import { joinVoiceChannel } from "@discordjs/voice";
import { DiscordGatewayAdapterCreator } from "@discordjs/voice/dist";
import { AudioSnippet } from "./types/audio";
import {
  clearSnippetTimer,
  openOutputFile,
  subscribeToUserVoice,
  updateSnippetsIfNecessary,
  userStopTalking,
} from "./audio";
import {
  MAXIMUM_MEETING_DURATION,
  MAXIMUM_MEETING_DURATION_PRETTY,
} from "./constants";

const meetings = new Map<string, MeetingData>();

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
  voiceChannel: VoiceBasedChannel;
  textChannel: TextChannel;
  guild: Guild;
  creator: User;
  transcribeMeeting: boolean;
  generateNotes: boolean;
  initialInteraction?: ButtonInteraction;
  isAutoRecording?: boolean;
  onTimeout?: (meeting: MeetingData) => void;
}

/**
 * Initializes a new meeting with voice recording and chat logging.
 * This is the core function used by both manual and auto-recording features.
 *
 * @param options - Configuration options for the meeting
 * @returns The initialized MeetingData object
 * @throws Error if voice connection fails or if meeting setup encounters issues
 */
export async function initializeMeeting(
  options: MeetingInitOptions,
): Promise<MeetingData> {
  const {
    voiceChannel,
    textChannel,
    guild,
    creator,
    transcribeMeeting,
    generateNotes,
    initialInteraction,
    isAutoRecording = false,
    onTimeout,
  } = options;

  // Join the voice channel
  let connection;
  try {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator:
        guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
  } catch (error) {
    console.error("Failed to join voice channel:", error);
    throw new Error(
      `Failed to join voice channel: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const receiver = connection.receiver;
  const attendance: Set<string> = new Set<string>();

  let setFinished: ((val?: void) => void) | undefined = undefined;
  const isFinished = new Promise<void>((resolve) => {
    setFinished = resolve;
  });

  const meeting: MeetingData = {
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
    startTime: new Date(),
    creator,
    isFinished,
    setFinished: () => setFinished && setFinished(),
    finishing: false,
    finished: false,
    guild,
    initialInteraction,
    transcribeMeeting,
    generateNotes,
  };

  // Open output file for audio recording
  openOutputFile(meeting);

  // Set up error handling for the connection
  connection.on("error", (error) => {
    console.error("Voice connection error:", error);
    textChannel.send(
      `There was an error trying to join the voice channel${isAutoRecording ? " for auto-recording" : ""}.`,
    );
  });

  // Record initial attendance
  voiceChannel.members.forEach((member) => attendance.add(member.user.tag));

  // Subscribe to initial members' voice
  await Promise.all(
    voiceChannel.members.map((member) =>
      subscribeToUserVoice(meeting, member.user.id),
    ),
  );

  // Set up speaking event handlers
  receiver.speaking.on("start", (userId) => {
    clearSnippetTimer(meeting, userId);
    updateSnippetsIfNecessary(meeting, userId);
  });

  receiver.speaking.on("end", (userId) => {
    userStopTalking(meeting, userId);
  });

  // Set up chat collector
  const collector = voiceChannel.createMessageCollector();
  collector.on("collect", (message) => {
    if (message.author.bot) return;

    meeting.chatLog.push(
      `[${message.author.tag} @ ${new Date(message.createdTimestamp).toLocaleString()}]: ${message.content}`,
    );
    meeting.attendance.add(message.author.tag);
  });

  // Add meeting to the global map
  addMeeting(meeting);

  // Set a timer to automatically end the meeting after the specified duration
  if (onTimeout) {
    meeting.timeoutTimer = setTimeout(() => {
      textChannel.send(
        `Ending ${isAutoRecording ? "auto-recorded " : ""}meeting due to maximum meeting time of ${MAXIMUM_MEETING_DURATION_PRETTY} having been reached.`,
      );
      onTimeout(meeting);
    }, MAXIMUM_MEETING_DURATION);
  }

  return meeting;
}
