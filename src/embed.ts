import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
} from "discord.js";
import { MeetingData } from "./types/meeting-data";
import { config } from "./services/configService";
import { buildPortalMeetingUrl } from "./utils/portalLinks";
import { buildSummaryFeedbackButtonIds } from "./commands/summaryFeedback";
import { MEETING_RENAME_PREFIX } from "./commands/meetingName";

const PROCESSING_COLOR = 0x3498db;
const SUMMARY_COLOR = 0x00ae86;
const DEFAULT_TITLE = "Meeting Summary";
const MAX_FIELD_VALUE = 1024;

type MeetingMessagePayload = {
  embeds: EmbedBuilder[];
  components?: Array<ActionRowBuilder<ButtonBuilder>>;
};

function buildMeetingHistoryKey(meeting: MeetingData): string {
  return `${meeting.voiceChannel.id}#${meeting.startTime.toISOString()}`;
}

function formatTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function formatDurationMinutes(start: Date, end: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 60000),
  );
  return `${minutes} minutes`;
}

function truncateFieldValue(value: string, max = MAX_FIELD_VALUE): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function buildMeetingFields(meeting: MeetingData) {
  const attendanceList = Array.from(meeting.attendance).join("\n");
  const startLabel = formatTimestamp(meeting.startTime);
  const endLabel = meeting.endTime
    ? formatTimestamp(meeting.endTime)
    : "Unknown";
  const durationLabel = meeting.endTime
    ? formatDurationMinutes(meeting.startTime, meeting.endTime)
    : formatDurationMinutes(meeting.startTime, new Date());

  const fields = [
    { name: "Start Time", value: startLabel, inline: true },
    { name: "End Time", value: endLabel, inline: true },
    { name: "Duration", value: durationLabel, inline: true },
    {
      name: "Attendees",
      value: truncateFieldValue(attendanceList || "No members recorded."),
    },
    { name: "Voice Channel", value: meeting.voiceChannel.name },
  ];

  if (meeting.tags && meeting.tags.length) {
    fields.push({
      name: "Tags",
      value: truncateFieldValue(meeting.tags.join(", ")),
      inline: true,
    });
  }

  return fields;
}

function resolveMeetingTitle(meeting: MeetingData): string {
  const name = meeting.meetingName?.trim();
  if (name) return name;
  const label = meeting.summaryLabel?.trim();
  if (label) return label;
  return DEFAULT_TITLE;
}

function buildProcessingEmbed(meeting: MeetingData): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${resolveMeetingTitle(meeting)} (processing)`)
    .setColor(PROCESSING_COLOR)
    .setDescription(
      "Processing transcript and meeting notes. This can take a few minutes.",
    )
    .addFields(buildMeetingFields(meeting))
    .setTimestamp();
}

function buildSummaryEmbed(meeting: MeetingData): EmbedBuilder {
  const summary = meeting.summarySentence?.trim();
  return new EmbedBuilder()
    .setTitle(resolveMeetingTitle(meeting))
    .setColor(SUMMARY_COLOR)
    .setDescription(
      summary && summary.length > 0 ? summary : "Summary unavailable.",
    )
    .addFields(buildMeetingFields(meeting))
    .setTimestamp();
}

function buildMeetingPortalUrl(meeting: MeetingData): string {
  const base = config.frontend.siteUrl.replace(/\/$/, "");
  return buildPortalMeetingUrl({
    baseUrl: base,
    guildId: meeting.guildId,
    meetingId: buildMeetingHistoryKey(meeting),
  });
}

function buildSummaryComponents(
  meeting: MeetingData,
  portalUrl: string,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const channelIdTimestamp = buildMeetingHistoryKey(meeting);
  const encodedKey = Buffer.from(channelIdTimestamp).toString("base64");
  const feedbackIds = buildSummaryFeedbackButtonIds(channelIdTimestamp);
  const buttons: ButtonBuilder[] = [
    new ButtonBuilder()
      .setCustomId(feedbackIds.up)
      .setLabel("Helpful")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(feedbackIds.down)
      .setLabel("Needs work")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`notes_correction:${meeting.guildId}:${encodedKey}`)
      .setLabel("Suggest correction")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${MEETING_RENAME_PREFIX}:${meeting.guildId}:${encodedKey}`)
      .setLabel("Rename meeting")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`edit_tags_history:${meeting.guildId}:${encodedKey}`)
      .setLabel("Edit tags")
      .setStyle(ButtonStyle.Secondary),
  ];
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
  ];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Open in Chronote")
        .setStyle(ButtonStyle.Link)
        .setURL(portalUrl),
    ),
  );
  return rows;
}

async function updateMeetingMessage(
  meeting: MeetingData,
  payload: MeetingMessagePayload,
): Promise<{ message?: Message; source: "edited" | "sent" | "none" }> {
  const channel = meeting.textChannel;
  if (meeting.startMessageId) {
    try {
      const message = await channel.messages.fetch(meeting.startMessageId);
      await message.edit(payload);
      return { message, source: "edited" };
    } catch (error) {
      console.warn("Failed to update meeting start message", error);
    }
  }

  try {
    const message = await channel.send(payload);
    meeting.startMessageId = message.id;
    return { message, source: "sent" };
  } catch (error) {
    console.warn("Failed to send meeting status message", error);
    return { source: "none" };
  }
}

export async function updateMeetingProcessingMessage(
  meeting: MeetingData,
): Promise<void> {
  await updateMeetingMessage(meeting, {
    embeds: [buildProcessingEmbed(meeting)],
    components: [],
  });
}

export async function updateMeetingSummaryMessage(
  meeting: MeetingData,
): Promise<void> {
  const portalUrl = buildMeetingPortalUrl(meeting);
  const { message } = await updateMeetingMessage(meeting, {
    embeds: [buildSummaryEmbed(meeting)],
    components: buildSummaryComponents(meeting, portalUrl),
  });

  if (message) {
    meeting.notesMessageIds = [message.id];
    meeting.notesChannelId = meeting.textChannel.id;
  }
}
