import {VoiceConnection} from "@discordjs/voice";
import {TextChannel, VoiceBasedChannel} from "discord.js";
import {AudioSnippet} from "./audio";

export interface MeetingData {
    chatLog: string[];
    attendance: Set<string>;
    connection: VoiceConnection;
    textChannel: TextChannel;
    voiceChannel: VoiceBasedChannel;
    guildId: string;
    channelId: string;
    audioData: Map<string, AudioSnippet[]>;
}