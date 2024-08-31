import {Client, CommandInteraction} from "discord.js";
import {deleteMeeting, getMeeting} from "../meetings";
import {unlinkSync, writeFileSync} from "node:fs";
import {
    combineAudioWithFFmpeg, compileTranscriptions,
    startProcessingCurrentSnippet,
    waitForFinishProcessing,
} from "../audio";
import {sendMeetingEndEmbed} from "../embed";
import { deleteIfExists } from "../util";

export async function handleEndMeeting(client: Client, interaction: CommandInteraction) {
    try {
        const guildId = interaction.guildId!;
        const channelId = interaction.channelId;

        const meeting = getMeeting(guildId, channelId);

        if (!meeting) {
            await interaction.reply('No active meeting to end in this channel.');
            return;
        }

        meeting.endTime = new Date();

        // Acknowledge the interaction immediately
        await interaction.deferReply();

        if (meeting.connection) {
            meeting.connection.disconnect();
            meeting.connection.destroy();
        }

        const chatLogFilePath = `./chatlog-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        const audioFilePath = `./meeting-${meeting.guildId}-${meeting.channelId}-${Date.now()}.mp3`;

        // checking if the current snippet exists should only matter when there was no audio recorded at all
        if(meeting.audioData.currentSnippet) {
            startProcessingCurrentSnippet(meeting);
        }

        await waitForFinishProcessing(meeting);

        await combineAudioWithFFmpeg(meeting.audioData.audioFiles, audioFilePath);

        const transcriptions = compileTranscriptions(client, meeting);

        const transcriptionFilePath = `./transcription-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions);

        await sendMeetingEndEmbed(meeting, chatLogFilePath, audioFilePath, transcriptionFilePath);

        // Edit the initial deferred reply to include the final message
        await interaction.editReply('Meeting ended, the summary has been posted.');

        deleteMeeting(guildId, channelId);
        deleteIfExists(chatLogFilePath);
        deleteIfExists(audioFilePath);
        deleteIfExists(transcriptionFilePath);

    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}
