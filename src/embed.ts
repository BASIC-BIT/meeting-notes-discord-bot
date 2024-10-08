import { MeetingData } from "./types/meeting-data";
import {
  EmbedBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  TextChannel,
} from "discord.js";
import { doesFileHaveContent } from "./util";
import { format } from "date-fns";
import { BaseMessageOptions } from "discord.js/typings";
import { ChunkInfo } from "./types/audio"; // Assuming date-fns is installed for date formatting

export async function sendMeetingEndEmbedToChannel(
  meeting: MeetingData,
  channel: TextChannel,
  chatLogFilePath: string,
  audioChunks: ChunkInfo[],
): Promise<void> {
  await channel.send(getEmbed(meeting));
  await sendAudioFiles(channel, chatLogFilePath, audioChunks);
}

export async function sendMeetingEndEmbed(
  meeting: MeetingData,
  interaction: ButtonInteraction,
  chatLogFilePath: string,
  audioChunks: ChunkInfo[],
): Promise<void> {
  await interaction.editReply(getEmbed(meeting));
  await sendAudioFiles(meeting.textChannel, chatLogFilePath, audioChunks);
}

async function sendAudioFiles(
  channel: TextChannel,
  chatLogFilePath: string,
  audioChunks: ChunkInfo[],
) {
  const files: AttachmentBuilder[] = [];
  if (doesFileHaveContent(chatLogFilePath)) {
    files.push(new AttachmentBuilder(chatLogFilePath).setName("ChatLog.txt"));
  }
  audioChunks.forEach((chunk, index) => {
    files.push(
      new AttachmentBuilder(chunk.file).setName(`audio_${index + 1}.mp3`),
    );
  });

  await channel.send({
    files,
  });
}

function getEmbed(meeting: MeetingData): BaseMessageOptions {
  const attendanceList = Array.from(meeting.attendance).join("\n");
  const meetingStart = format(meeting.startTime, "PPpp"); // Format the meeting start time
  const meetingEnd = format(meeting.endTime!, "PPpp"); // Current time as the meeting end time
  const meetingDuration = Math.floor(
    (Date.now() - meeting.startTime.getTime()) / 60000,
  ); // Duration in minutes

  const embed = new EmbedBuilder()
    .setTitle("📋 Meeting Summary")
    .setColor("#3498db")
    .setDescription("Here are the details of the recent meeting:")
    .addFields(
      { name: "🕒 Meeting Start", value: meetingStart, inline: true },
      { name: "🕒 Meeting End", value: meetingEnd, inline: true },
      {
        name: "⏱️ Duration",
        value: `${meetingDuration} minutes`,
        inline: true,
      },
      {
        name: "👥 Members in Attendance",
        value: attendanceList || "No members recorded.",
      },
      { name: "🔊 Voice Channel", value: `**${meeting.voiceChannel.name}**` },
      {
        name: "🔗 GitHub Repository",
        value:
          "[View Bot on GitHub](https://github.com/BASIC-BIT/meeting-notes-discord-bot)",
        inline: true,
      },
      {
        name: "☕ Donate",
        value: "[Support Me On Kofi](https://ko-fi.com/basicbit)",
        inline: true,
      },
    )
    // .setFooter({ text: 'Generated by Meeting Notes Bot • Version 1.0.0', iconURL: 'https://example.com/icon.png' }) // Example footer with version info
    .setTimestamp();

  return {
    embeds: [embed],
  };
}

// TODO: Remove?
// Function to generate a progress bar
// function createProgressBar(percentage: number): string {
//   const totalBars = 20;
//   const filledBars = Math.round((percentage / 100) * totalBars);
//   const emptyBars = totalBars - filledBars;
//   const bar = "█".repeat(filledBars) + "░".repeat(emptyBars);
//   return `${bar} ${percentage}%`;
// }

// async function updateEndMessage(
//   interaction: CommandInteraction,
//   processedSnippets: number,
//   totalSnippets: number,
//   status: string,
//   isComplete: boolean = false,
// ) {
//   const progressPercentage = Math.floor(
//     (processedSnippets / totalSnippets) * 100,
//   );
//   const progressBar = createProgressBar(progressPercentage);
//
//   const embed = new EmbedBuilder()
//     .setTitle("Meeting End Progress")
//     .setDescription(`Processing meeting data...`)
//     .addFields(
//       {
//         name: "Audio Snippets",
//         value: `${processedSnippets}/${totalSnippets} snippets processed... ${progressBar}`,
//       },
//       {
//         name: "Splitting Audio",
//         value: isComplete
//           ? `✅ Audio data split into ${processedSnippets / 25} files`
//           : `🔄 Splitting... ${progressBar}`,
//       },
//       {
//         name: "Uploading",
//         value:
//           status === "uploading"
//             ? "🔄 Uploading..."
//             : status === "done"
//               ? "✅ Done!"
//               : "⬜ Waiting to upload...",
//       },
//     )
//     .setTimestamp();
//
//   // If first time, reply to interaction, otherwise edit existing reply
//   if (interaction.replied) {
//     await interaction.editReply({ embeds: [embed] });
//   } else {
//     await interaction.reply({ embeds: [embed] });
//   }
// }

export async function sendTranscriptionFiles(
  meeting: MeetingData,
  transcriptionFilePath: string,
): Promise<void> {
  if (doesFileHaveContent(transcriptionFilePath)) {
    await meeting.textChannel.send({
      files: [new AttachmentBuilder(transcriptionFilePath)],
    });
  }
}
