import {VoiceConnection} from "@discordjs/voice";
import {TextChannel, VoiceBasedChannel} from "discord.js";
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
}