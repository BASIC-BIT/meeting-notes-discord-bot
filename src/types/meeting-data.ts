import { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import {
  ButtonInteraction,
  CommandInteraction,
  Guild,
  TextChannel,
  User,
  VoiceBasedChannel,
} from "discord.js";
import { AudioData } from "./audio";
import { ChatEntry } from "./chat";
import { Participant } from "./participants";

export interface MeetingData {
  meetingId: string;
  chatLog: ChatEntry[];
  attendance: Set<string>;
  connection: VoiceConnection;
  textChannel: TextChannel;
  voiceChannel: VoiceBasedChannel;
  guildId: string;
  channelId: string;
  audioData: AudioData;
  startTime: Date;
  endTime?: Date;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  creator: User;
  guild: Guild;
  initialInteraction?: ButtonInteraction;
  isAutoRecording: boolean;

  liveAudioPlayer?: AudioPlayer;
  liveVoiceEnabled?: boolean;

  finishing: boolean;
  // Used for functions that are waiting for the meeting to be completely over
  isFinished: Promise<void>;
  setFinished: () => void;
  finished: boolean;

  transcribeMeeting: boolean;
  generateNotes: boolean;
  meetingContext?: string;

  finalTranscript?: string;
  transcriptS3Key?: string;
  notesMessageIds?: string[];
  notesChannelId?: string;
  notesVersion?: number;
  notesLastEditedBy?: string;
  notesLastEditedAt?: string;
  notesText?: string;
  participants: Map<string, Participant>;
  audioS3Key?: string;
  chatS3Key?: string;
  tags?: string[];
  startMessageId?: string;
}

export interface MeetingSetup {
  interaction: CommandInteraction;
}
