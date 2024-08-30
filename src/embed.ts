import {MeetingData} from "./types/meeting-data";
import {EmbedBuilder} from "discord.js";
import {doesFileHaveContent} from "./util";

export async function sendMeetingEndEmbed(meeting: MeetingData, chatLogFilePath: string, transcriptionFilePath: string): Promise<void> {
    const attendanceList = Array.from(meeting.attendance).join('\n');

    const embed = new EmbedBuilder()
        .setTitle('Meeting Summary')
        .setColor(0x00AE86)
        .setDescription('Here are the details of the recent meeting:')
        .addFields(
            { name: 'Members in Attendance', value: attendanceList || 'No members recorded.' },
        )
        .setTimestamp();

    const files = [];
    if (doesFileHaveContent(chatLogFilePath)) {
        files.push({ attachment: chatLogFilePath, name: 'ChatLog.txt' });
    }
    if (doesFileHaveContent(meeting.audioFilePath)) {
        files.push({ attachment: meeting.audioFilePath, name: 'AudioRecording.wav' });
    }
    if (doesFileHaveContent(transcriptionFilePath)) {
        files.push({ attachment: transcriptionFilePath, name: 'Transcription.txt' });
    }
    await meeting.textChannel.send({
        embeds: [embed],
        files,
    });
}