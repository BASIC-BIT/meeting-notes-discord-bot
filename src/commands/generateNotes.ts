import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from "discord.js";
import { getNotes } from "../transcription";
import { MeetingData } from "../types/meeting-data";
import { buildPaginatedEmbeds } from "../utils/embedPagination";

export async function generateAndSendNotes(meeting: MeetingData) {
  // const [notes, image] = await Promise.all([getNotes(meeting), getImage(meeting)]);
  const notes = await getNotes(meeting);
  meeting.notesText = notes;

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

    const editTagsHistoryButton = new ButtonBuilder()
      .setCustomId(`edit_tags_history:${meeting.guildId}:${encodedKey}`)
      .setLabel("Edit Tags")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      correctionButton,
      editTagsHistoryButton,
    );

    const footerText = `v1 • Posted by ${meeting.creator.tag}`;
    const embeds = buildPaginatedEmbeds({
      text: notes,
      baseTitle: "Meeting Notes (AI Generated)",
      footerText,
    });

    const sentMessages: Message[] = [];

    for (let i = 0; i < embeds.length; i++) {
      const message = await meeting.textChannel.send({
        embeds: [embeds[i]],
        components: i === 0 ? [row] : [],
      });
      sentMessages.push(message);
    }

    meeting.notesMessageIds = sentMessages.map((m) => m.id);
    meeting.notesChannelId = meeting.textChannel.id;
    meeting.notesVersion = 1;
    meeting.notesLastEditedBy = meeting.creator.id;
    meeting.notesLastEditedAt = new Date().toISOString();
  }
}
