import {Client, CommandInteraction} from "discord.js";
import {deleteMeeting, getMeeting} from "../meetings";
import {writeFileSync} from "node:fs";
import {combineAudioWithFFmpeg, mergeSnippetsAcrossUsers, synchronizeUserAudio} from "../audio";
import {transcribeSnippet} from "../transcription";
import {sendMeetingEndEmbed} from "../embed";

export async function handleEndMeeting(client: Client, interaction: CommandInteraction) {
    try {
        const guildId = interaction.guildId!;
        const channelId = interaction.channelId;

        const meeting = getMeeting(guildId, channelId);
        if (!meeting || !meeting.active) {
            await interaction.reply('No active meeting to end in this channel.');
            return;
        }

        // Acknowledge the interaction immediately
        await interaction.deferReply();

        if (meeting.connection) {
            meeting.connection.disconnect();
            meeting.connection.destroy();
        }

        const chatLogFilePath = `./logs/chatlog-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        const userBuffers: string[] = [];
        const transcriptionPromises: Promise<string>[] = [];

        const mergedSnippets = mergeSnippetsAcrossUsers(meeting.audioData);

        mergedSnippets.forEach(mergedSnippet => {
            const synchronizedBuffer = synchronizeUserAudio([mergedSnippet.snippet]);

            if (synchronizedBuffer.length > 0) {
                const fileName = `./temp_user_${mergedSnippet.userId}_${mergedSnippet.snippet.timestamp}.pcm`;
                writeFileSync(fileName, synchronizedBuffer);
                userBuffers.push(fileName);
            } else {
                console.warn(`Empty buffer detected for user ${mergedSnippet.userId} at timestamp ${mergedSnippet.snippet.timestamp}, skipping.`);
            }

            const userTag = client.users.cache.get(mergedSnippet.userId)?.tag ?? mergedSnippet.userId;

            transcriptionPromises.push(transcribeSnippet(mergedSnippet.snippet, mergedSnippet.userId, userTag));
        });

        if (userBuffers.length > 0) {
            await combineAudioWithFFmpeg(userBuffers, meeting.audioFilePath);
        } else {
            console.error('No valid audio files to combine.');
            throw new Error('No valid audio files to combine.');
        }

        const transcriptions = await Promise.all(transcriptionPromises);
        const transcriptionFilePath = `./logs/transcription-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions.join('\n'));

        await sendMeetingEndEmbed(meeting, chatLogFilePath, transcriptionFilePath);

        // Edit the initial deferred reply to include the final message
        await interaction.editReply('Meeting ended, the summary has been posted.');

        deleteMeeting(guildId, channelId);

    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}
