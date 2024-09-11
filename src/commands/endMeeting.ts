import { ButtonInteraction, Client, PermissionFlagsBits, PermissionResolvable } from "discord.js";
import {deleteMeeting, getMeeting} from "../meetings";
import {writeFileSync} from "node:fs";
import {
    closeOutputFile,
    compileTranscriptions, splitAudioIntoChunks, startProcessingSnippet, waitForAudioOnlyFinishProcessing,
    waitForFinishProcessing,
} from "../audio";
import { sendMeetingEndEmbed, sendMeetingEndEmbedToChannel, sendTranscriptionFiles } from "../embed";
import { deleteDirectoryRecursively, deleteIfExists } from "../util";
import { MeetingData } from "../types/meeting-data";

function doesUserHavePermissionToEndMeeting(meeting: MeetingData, userId: string): boolean {
    if(meeting.creator.id === userId) {
        return true; // Creator of a meeting can always end it
    }

    const member = meeting.guild.members.cache.get(userId);
    if(!member) {
        return false;
    }

    const requiresAnyPermission = PermissionFlagsBits.ModerateMembers + PermissionFlagsBits.Administrator + PermissionFlagsBits.ManageMessages;

    return member.permissions.any(requiresAnyPermission as unknown as PermissionResolvable);
}

export async function handleEndMeetingButton(client: Client, interaction: ButtonInteraction) {
    try {
        const guildId = interaction.guildId!;
        const channelId = interaction.channelId;

        const meeting = getMeeting(guildId);

        if (!meeting) {
            await interaction.reply('No active meeting to end in this channel.');
            return;
        }

        if(!doesUserHavePermissionToEndMeeting(meeting, interaction.user.id)) {
            await interaction.reply('You do not have permission to end this meeting.');
            return;
        }


        if(meeting.finishing) {
            await interaction.reply("Meeting is already finishing!");
            return;
        }

        if(meeting.timeoutTimer) {
            clearTimeout(meeting.timeoutTimer);
            meeting.timeoutTimer = undefined;
        }

        meeting.finishing = true;
        meeting.endTime = new Date();

        // Acknowledge the interaction immediately
        await interaction.deferReply();

        try {
            await meeting.initialInteraction.editReply({
                components: [],
            }); //Remove "End Meeting" button from initial reply if able
        } catch (e) {
            console.log("Initial Interaction timed out, couldn't remove End Meeting button from initial reply, continuing...")
        }

        if (meeting.connection) {
            meeting.connection.disconnect();
            meeting.connection.destroy();
        }

        const chatLogFilePath = `./chatlog-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        // checking if the current snippet exists should only matter when there was no audio recorded at all
        meeting.audioData.currentSnippets.forEach((snippet) => {
            startProcessingSnippet(meeting, snippet.userId);
        });

        await waitForAudioOnlyFinishProcessing(meeting);

        await closeOutputFile(meeting);

        const splitAudioDir = `./split_${meeting.guildId}_${meeting.channelId}_${Date.now()}`;
        const splitFiles = await splitAudioIntoChunks(meeting.audioData.outputFileName!, splitAudioDir);

        await sendMeetingEndEmbed(meeting, interaction, chatLogFilePath, splitFiles);

        deleteIfExists(chatLogFilePath);
        deleteIfExists(meeting.audioData.outputFileName!);

        const waitingForTranscriptionsMessage = await meeting.textChannel.send("Processing transcription... please wait...");

        await waitForFinishProcessing(meeting);

        const transcriptions = await compileTranscriptions(client, meeting);

        const transcriptionFilePath = `./transcription-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions);

        await sendTranscriptionFiles(meeting, transcriptionFilePath);

        await waitingForTranscriptionsMessage.delete();

        deleteMeeting(guildId);
        deleteIfExists(transcriptionFilePath);
        deleteDirectoryRecursively(splitAudioDir);

        meeting.setFinished();
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

        meeting.finishing = true;
        meeting.endTime = new Date();

        try {
            await meeting.initialInteraction.editReply({
                components: [],
            }); //Remove "End Meeting" button from initial reply if able
        } catch (e) {
            console.log("Initial Interaction timed out, couldn't remove End Meeting button from initial reply, continuing...")
        }

        if (meeting.connection) {
            meeting.connection.disconnect();
            meeting.connection.destroy();
        }

        const chatLogFilePath = `./chatlog-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`;
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        // checking if the current snippet exists should only matter when there was no audio recorded at all
        meeting.audioData.currentSnippets.forEach((snippet) => {
            startProcessingSnippet(meeting, snippet.userId);
        });

        await waitForAudioOnlyFinishProcessing(meeting);

        await closeOutputFile(meeting);

        const splitAudioDir = `./split_${meeting.guildId}_${meeting.channelId}_${Date.now()}`;
        const splitFiles = await splitAudioIntoChunks(meeting.audioData.outputFileName!, splitAudioDir);

        await sendMeetingEndEmbedToChannel(meeting, meeting.textChannel, chatLogFilePath, splitFiles);

        deleteIfExists(chatLogFilePath);
        deleteIfExists(meeting.audioData.outputFileName!);

        const waitingForTranscriptionsMessage = await meeting.textChannel.send("Processing transcription... please wait...");

        await waitForFinishProcessing(meeting);

        const transcriptions = await compileTranscriptions(client, meeting);

        const transcriptionFilePath = `./transcription-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions);

        await sendTranscriptionFiles(meeting, transcriptionFilePath);

        await waitingForTranscriptionsMessage.delete();

        deleteMeeting(meeting.guildId);
        deleteIfExists(transcriptionFilePath);
        deleteDirectoryRecursively(splitAudioDir);

        meeting.setFinished();
    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}
