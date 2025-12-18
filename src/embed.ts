import { MeetingData } from "./types/meeting-data";
import {
  EmbedBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { doesFileHaveContent } from "./util";
import { format } from "date-fns";
import { BaseMessageOptions } from "discord.js/typings";
import { ChunkInfo } from "./types/audio";

export async function sendMeetingEndEmbedToChannel(
  meeting: MeetingData,
  channel: TextChannel,
  chatLogFilePath: string,
  audioChunks: ChunkInfo[],
): Promise<void> {
  await channel.send({
    ...getEmbed(meeting),
    ...getTagsRow(meeting),
  });
  await sendAudioFiles(channel, chatLogFilePath, audioChunks);
}

export async function sendMeetingEndEmbed(
  meeting: MeetingData,
  interaction: ButtonInteraction,
  chatLogFilePath: string,
  audioChunks: ChunkInfo[],
): Promise<void> {
  await interaction.editReply({
    ...getEmbed(meeting),
    ...getTagsRow(meeting),
  });
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
      ...(meeting.tags && meeting.tags.length
        ? [
            {
              name: "🏷 Tags",
              value: meeting.tags.join(", "),
              inline: true,
            },
          ]
        : []),
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
    .setTimestamp();

  return {
    embeds: [embed],
  };
}

function getTagsRow(meeting: MeetingData) {
  const channelIdTimestamp = `${meeting.voiceChannel.id}#${meeting.startTime.toISOString()}`;
  const encodedKey =
    typeof Buffer !== "undefined"
      ? Buffer.from(channelIdTimestamp).toString("base64")
      : channelIdTimestamp;

  const editTagsHistoryButton = new ButtonBuilder()
    .setCustomId(`edit_tags_history:${meeting.guildId}:${encodedKey}`)
    .setLabel("Edit Tags")
    .setStyle(ButtonStyle.Secondary);

  return {
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        editTagsHistoryButton,
      ),
    ],
  };
}

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
