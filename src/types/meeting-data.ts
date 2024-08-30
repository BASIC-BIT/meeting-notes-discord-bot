import {VoiceConnection} from "@discordjs/voice";
import {TextChannel, VoiceBasedChannel} from "discord.js";
import {AudioSnippet} from "./audio";

export interface MeetingData {
    active: boolean;
    chatLog: string[];
    attendance: Set<string>;
    audioFilePath: string;
    connection: VoiceConnection;
    textChannel: TextChannel;
    guildId: string;
    channelId: string;
    audioData: Map<string, AudioSnippet[]>;
    voiceChannel: VoiceBasedChannel;
}