import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from "discord.js";
import { getNotes } from "../transcription";
import { generateMeetingSummaries } from "../services/meetingSummaryService";
import { resolveMeetingNameFromSummary } from "../services/meetingNameService";
import { MeetingData } from "../types/meeting-data";
import { formatNotesWithSummary } from "../utils/notesSummary";
import { buildMeetingNotesEmbeds } from "../utils/meetingNotes";
import { MEETING_RENAME_PREFIX } from "./meetingName";
import { buildSummaryFeedbackButtonIds } from "./summaryFeedback";

export async function generateAndSendNotes(meeting: MeetingData) {
  // const [notes, image] = await Promise.all([getNotes(meeting), getImage(meeting)]);
  const notes = await getNotes(meeting);
  meeting.notesText = notes;

  if (notes && notes.length) {
    const summaries = await generateMeetingSummaries({
      guildId: meeting.guildId,
      notes,
      serverName: meeting.guild.name,
      channelName: meeting.voiceChannel.name,
      tags: meeting.tags,
      now: meeting.startTime ?? new Date(),
      meetingId: meeting.meetingId,
      previousSummarySentence: meeting.summarySentence,
      previousSummaryLabel: meeting.summaryLabel,
      parentSpanContext: meeting.langfuseParentSpanContext,
      modelParams: meeting.runtimeConfig?.modelParams?.meetingSummary,
    });
    meeting.summarySentence = summaries.summarySentence;
    meeting.summaryLabel = summaries.summaryLabel;
    if (!meeting.meetingName) {
      meeting.meetingName = await resolveMeetingNameFromSummary({
        guildId: meeting.guildId,
        meetingId: meeting.meetingId,
        summaryLabel: summaries.summaryLabel,
      });
    }
    const notesBody = formatNotesWithSummary(notes, summaries.summarySentence);
    const channelIdTimestamp = `${meeting.voiceChannel.id}#${meeting.startTime.toISOString()}`;
    const feedbackIds = buildSummaryFeedbackButtonIds(channelIdTimestamp);
    const encodedKey =
      typeof Buffer !== "undefined"
        ? Buffer.from(channelIdTimestamp).toString("base64")
        : channelIdTimestamp;

    const feedbackUpButton = new ButtonBuilder()
      .setCustomId(feedbackIds.up)
      .setLabel("Helpful")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("👍");

    const feedbackDownButton = new ButtonBuilder()
      .setCustomId(feedbackIds.down)
      .setLabel("Needs work")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("👎");

    const correctionButton = new ButtonBuilder()
      .setCustomId(`notes_correction:${meeting.guildId}:${encodedKey}`)
      .setLabel("Suggest correction")
      .setStyle(ButtonStyle.Secondary);

    const renameButton = new ButtonBuilder()
      .setCustomId(`${MEETING_RENAME_PREFIX}:${meeting.guildId}:${encodedKey}`)
      .setLabel("Rename meeting")
      .setStyle(ButtonStyle.Secondary);

    const editTagsHistoryButton = new ButtonBuilder()
      .setCustomId(`edit_tags_history:${meeting.guildId}:${encodedKey}`)
      .setLabel("Edit Tags")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      feedbackUpButton,
      feedbackDownButton,
      correctionButton,
      renameButton,
      editTagsHistoryButton,
    );

    const footerText = `v1 • Posted by ${meeting.creator.tag}`;
    const embeds = buildMeetingNotesEmbeds({
      notesBody,
      meetingName: meeting.meetingName,
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
