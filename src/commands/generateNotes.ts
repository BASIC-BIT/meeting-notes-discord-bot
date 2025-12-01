import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getNotes } from "../transcription";
import { MeetingData } from "../types/meeting-data";

export async function generateAndSendNotes(meeting: MeetingData) {
  // const [notes, image] = await Promise.all([getNotes(meeting), getImage(meeting)]);
  const notes = await getNotes(meeting);

  if (notes && notes.length) {
    const channelIdTimestamp = `${meeting.voiceChannel.id}#${meeting.startTime.toISOString()}`;
    const encodedKey =
      typeof Buffer !== "undefined"
        ? Buffer.from(channelIdTimestamp).toString("base64")
        : channelIdTimestamp;

    const correctionButton = new ButtonBuilder()
      .setCustomId(`notes_correction:${meeting.guildId}:${encodedKey}`)
      .setLabel("Suggest correction")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      correctionButton,
    );

    const message = await meeting.textChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Meeting Notes (AI Generated)")
          .setDescription(notes)
          .setFooter({ text: `v1 • Posted by ${meeting.creator.tag}` }),
        // .setImage(image)
      ],
      components: [row],
    });

    meeting.notesMessageId = message.id;
    meeting.notesChannelId = message.channelId;
    meeting.notesVersion = 1;
    meeting.notesLastEditedBy = meeting.creator.id;
  }
}
