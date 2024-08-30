import { MeetingData } from "./types/meeting-data";
import { EmbedBuilder, AttachmentBuilder } from "discord.js";
import { doesFileHaveContent } from "./util";
import { format } from "date-fns";  // Assuming date-fns is installed for date formatting

export async function sendMeetingEndEmbed(meeting: MeetingData, chatLogFilePath: string, audioFilePath: string, transcriptionFilePath: string): Promise<void> {
    const attendanceList = Array.from(meeting.attendance).join('\n');
    const meetingStart = format(meeting.startTime, "PPpp"); // Format the meeting start time
    const meetingEnd = format(new Date(), "PPpp"); // Current time as the meeting end time
    const meetingDuration = Math.floor((Date.now() - meeting.startTime.getTime()) / 60000); // Duration in minutes

    const embed = new EmbedBuilder()
        .setTitle('📋 Meeting Summary')
        .setColor('#3498db')
        .setDescription('Here are the details of the recent meeting:')
        .addFields(
            { name: '🕒 Meeting Start', value: meetingStart, inline: true },
            { name: '🕒 Meeting End', value: meetingEnd, inline: true },
            { name: '⏱️ Duration', value: `${meetingDuration} minutes`, inline: true },
            { name: '👥 Members in Attendance', value: attendanceList || 'No members recorded.' },
            { name: '💬 Number of Messages', value: `${meeting.chatLog.length}`, inline: true },
            { name: '🔗 GitHub Repository', value: '[View Bot on GitHub](https://github.com/BASIC-BIT/meeting-notes-discord-bot)', inline: false }
        )
        // .setFooter({ text: 'Generated by Meeting Notes Bot • Version 1.0.0', iconURL: 'https://example.com/icon.png' }) // Example footer with version info
        .setTimestamp();

    const files = [];
    if (doesFileHaveContent(chatLogFilePath)) {
        files.push(new AttachmentBuilder(chatLogFilePath).setName('ChatLog.txt'));
    }
    if (doesFileHaveContent(audioFilePath)) {
        files.push(new AttachmentBuilder(audioFilePath).setName('AudioRecording.wav'));
    }
    if (doesFileHaveContent(transcriptionFilePath)) {
        files.push(new AttachmentBuilder(transcriptionFilePath).setName('Transcription.txt'));
    }

    await meeting.textChannel.send({
        embeds: [embed],
        files,
    });
}