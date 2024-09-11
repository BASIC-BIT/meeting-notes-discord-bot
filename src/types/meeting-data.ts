import {VoiceConnection} from "@discordjs/voice";
import { CommandInteraction, Guild, TextChannel, User, VoiceBasedChannel } from "discord.js";
import {AudioData} from "./audio";

export interface MeetingData {
    chatLog: string[];
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
    initialInteraction: CommandInteraction;

    finishing: boolean;
    // Used for functions that are waiting for the meeting to be completely over
    isFinished: Promise<void>;
    setFinished: () => void;
}