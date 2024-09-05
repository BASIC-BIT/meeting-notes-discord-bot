import { ButtonInteraction, Client, CommandInteraction } from "discord.js";
import {deleteMeeting, getMeeting} from "../meetings";
import {writeFileSync} from "node:fs";
import {
    closeOutputFile,
    compileTranscriptions, startProcessingSnippet,
    waitForFinishProcessing,
} from "../audio";
import { sendMeetingEndEmbed, sendMeetingEndEmbedToChannel } from "../embed";
import { deleteIfExists } from "../util";
import { MeetingData } from "../types/meeting-data";

// TODO: End meeting on a timer, or if there's nobody left in voice chat
export async function handleEndMeetingButton(client: Client, interaction: ButtonInteraction) {
    try {
        const guildId = interaction.guildId!;
        const channelId = interaction.channelId;

        const meeting = getMeeting(guildId);

        if (!meeting) {
            await interaction.reply('No active meeting to end in this channel.');
            return;
        }

        if(meeting.timeoutTimer) {
            clearTimeout(meeting.timeoutTimer);
            meeting.timeoutTimer = undefined;
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

        // checking if the current snippet exists should only matter when there was no audio recorded at all
        meeting.audioData.currentSnippets?.forEach((snippet) => {
            startProcessingSnippet(meeting, snippet.userId);
        });

        await waitForFinishProcessing(meeting);

        await closeOutputFile(meeting);

        const transcriptions = await compileTranscriptions(client, meeting);

        const transcriptionFilePath = `./transcription-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions);

        await sendMeetingEndEmbed(meeting, interaction, chatLogFilePath, meeting.audioData.outputFileName!, transcriptionFilePath);

        deleteMeeting(guildId);
        deleteIfExists(chatLogFilePath);
        deleteIfExists(meeting.audioData.outputFileName!);
        deleteIfExists(transcriptionFilePath);

    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}

export async function handleEndMeetingOther(client: Client, meeting: MeetingData) {
    try {
        if(meeting.timeoutTimer) {
            clearTimeout(meeting.timeoutTimer);
            meeting.timeoutTimer = undefined;
        }

        meeting.endTime = new Date();

        if (meeting.connection) {
            meeting.connection.disconnect();
            meeting.connection.destroy();
        }

        const chatLogFilePath = `./chatlog-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`;
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        // checking if the current snippet exists should only matter when there was no audio recorded at all
        meeting.audioData.currentSnippets?.forEach((snippet) => {
            startProcessingSnippet(meeting, snippet.userId);
        });

        await waitForFinishProcessing(meeting);

        await closeOutputFile(meeting);

        const transcriptions = await compileTranscriptions(client, meeting);

        const transcriptionFilePath = `./transcription-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions);

        await sendMeetingEndEmbedToChannel(meeting, meeting.textChannel, chatLogFilePath, meeting.audioData.outputFileName!, transcriptionFilePath);

        deleteMeeting(meeting.guildId);
        deleteIfExists(chatLogFilePath);
        deleteIfExists(meeting.audioData.outputFileName!);
        deleteIfExists(transcriptionFilePath);

    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}
