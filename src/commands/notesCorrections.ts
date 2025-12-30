import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { diffLines } from "diff";
import { v4 as uuidv4 } from "uuid";
import {
  getMeetingHistoryService,
  updateMeetingNotesService,
} from "../services/meetingHistoryService";
import { stripCodeFences } from "../utils/text";
import { buildPaginatedEmbeds } from "../utils/embedPagination";
import { MeetingHistory, SuggestionHistoryEntry } from "../types/db";
import { fetchJsonFromS3 } from "../services/storageService";
import { formatParticipantLabel } from "../utils/participants";
import { generateMeetingSummaries } from "../services/meetingSummaryService";
import { formatNotesWithSummary } from "../utils/notesSummary";
import { createOpenAIClient } from "../services/openaiClient";
import { getModelChoice } from "../services/modelFactory";
import { config } from "../services/configService";
import { getLangfuseTextPrompt } from "../services/langfusePromptService";

type PendingCorrection = {
  guildId: string;
  channelIdTimestamp: string;
  channelId?: string;
  notesMessageIds?: string[];
  notesChannelId?: string;
  meetingCreatorId?: string;
  isAutoRecording?: boolean;
  tags?: string[];
  summarySentence?: string;
  summaryLabel?: string;
  originalNotes: string;
  newNotes: string;
  notesVersion: number;
  requesterId: string;
  suggestion: SuggestionHistoryEntry;
};

const pendingCorrections = new Map<string, PendingCorrection>();

const CORRECTION_PREFIX = "notes_correction";
const CORRECTION_MODAL_PREFIX = "notes_correction_modal";
const CORRECTION_ACCEPT_PREFIX = "notes_correction_accept";
const CORRECTION_REJECT_PREFIX = "notes_correction_reject";

function encodeKey(channelIdTimestamp: string): string {
  return Buffer.from(channelIdTimestamp).toString("base64");
}

function decodeKey(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}

function buildCorrectionRow(
  guildId: string,
  channelIdTimestamp: string,
): ActionRowBuilder<ButtonBuilder> {
  const encodedKey = encodeKey(channelIdTimestamp);
  const correctionButton = new ButtonBuilder()
    .setCustomId(`${CORRECTION_PREFIX}:${guildId}:${encodedKey}`)
    .setLabel("Suggest correction")
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(correctionButton);
}

function trimForDiscord(content: string, limit = 1800): string {
  if (content.length <= limit) return content;
  return content.substring(0, limit - 20) + "\n... (truncated)";
}

function buildUnifiedDiff(current: string, proposed: string): string {
  const changes = diffLines(current, proposed);
  const lines: string[] = [];

  for (const change of changes) {
    const prefix = change.added ? "+" : change.removed ? "-" : " ";
    const content = change.value.split("\n");
    for (const line of content) {
      if (line === "") continue;
      lines.push(`${prefix} ${line}`);
      if (lines.length > 400) break;
    }
    if (lines.length > 400) break;
  }

  return trimForDiscord(lines.join("\n"), 1800);
}

interface CorrectionInput {
  currentNotes: string;
  transcript: string;
  suggestion: string;
  requesterTag: string;
  previousSuggestions?: SuggestionHistoryEntry[];
}

function formatSuggestionsForPrompt(
  suggestions?: SuggestionHistoryEntry[],
): string {
  if (!suggestions || suggestions.length === 0) {
    return "None recorded yet.";
  }

  return suggestions
    .map(
      (entry) =>
        `- [${new Date(entry.createdAt).toLocaleString()}] ${entry.displayName || entry.userTag || entry.userId}: ${entry.text}`,
    )
    .join("\n");
}

async function generateCorrectedNotes({
  currentNotes,
  transcript,
  suggestion,
  requesterTag,
  previousSuggestions,
}: CorrectionInput): Promise<string> {
  const { prompt: systemPrompt, langfusePrompt } = await getLangfuseTextPrompt({
    name: config.langfuse.notesCorrectionPromptName,
  });

  const priorSuggestions = formatSuggestionsForPrompt(previousSuggestions);

  const userPrompt = `Current notes:
${currentNotes}

Previously approved suggestions (most recent first):
${priorSuggestions}

Transcript:
${transcript}

User (${requesterTag}) suggests:
"${suggestion}"

Return updated notes.`;

  try {
    const modelChoice = getModelChoice("notesCorrection");
    const openAIClient = createOpenAIClient({
      traceName: "notes-correction",
      generationName: "notes-correction",
      tags: ["feature:notes_correction"],
      metadata: {
        requesterTag,
      },
      langfusePrompt,
    });
    const completion = await openAIClient.chat.completions.create({
      model: modelChoice.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (content && content.trim().length > 0) {
      return stripCodeFences(content.trim());
    }
  } catch (error) {
    console.error("Failed to generate corrected notes:", error);
  }

  // Fallback: return original notes unchanged if AI call failed
  return currentNotes;
}

function canApprove(
  interaction: ButtonInteraction,
  pending: PendingCorrection,
): boolean {
  if (!pending.isAutoRecording) {
    return interaction.user.id === pending.meetingCreatorId;
  }

  // Auto-recorded: require ManageChannels (same as context command)
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageChannels);
}

export function isNotesCorrectionButton(customId: string): boolean {
  return customId.startsWith(`${CORRECTION_PREFIX}:`);
}

export function isNotesCorrectionAccept(customId: string): boolean {
  return customId.startsWith(`${CORRECTION_ACCEPT_PREFIX}:`);
}

export function isNotesCorrectionReject(customId: string): boolean {
  return customId.startsWith(`${CORRECTION_REJECT_PREFIX}:`);
}

export async function handleNotesCorrectionButton(
  interaction: ButtonInteraction,
) {
  const parts = interaction.customId.split(":");
  if (parts.length < 3) {
    await interaction.reply({
      content: "Sorry, I couldn't start the correction flow (invalid id).",
      ephemeral: true,
    });
    return;
  }

  const encodedKey = parts[2];
  // Keep customId under Discord's 100-char limit by omitting guildId (it's available on interaction)
  const modal = new ModalBuilder()
    .setCustomId(`${CORRECTION_MODAL_PREFIX}:${encodedKey}`)
    .setTitle("Suggest a correction");

  const suggestionInput = new TextInputBuilder()
    .setCustomId("correction_suggestion")
    .setLabel("Describe what should change in the notes")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1500);

  const suggestionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    suggestionInput,
  );

  modal.addComponents(suggestionRow);

  await interaction.showModal(modal);
}

export function isNotesCorrectionModal(customId: string): boolean {
  return customId.startsWith(`${CORRECTION_MODAL_PREFIX}:`);
}

export async function handleNotesCorrectionModal(
  interaction: ModalSubmitInteraction,
) {
  const parts = interaction.customId.split(":");
  if (parts.length < 2) {
    await interaction.reply({
      content: "Couldn't process that correction request.",
      ephemeral: true,
    });
    return;
  }

  const encodedKey = parts[1];
  const channelIdTimestamp = decodeKey(encodedKey);
  const guildId = interaction.guildId!;

  const history = await getMeetingHistoryService(guildId, channelIdTimestamp);

  if (!history || !history.notes) {
    await interaction.reply({
      content:
        "I couldn't find notes to compare against yet. Please try again once the meeting has finished processing.",
      ephemeral: true,
    });
    return;
  }

  const suggestion = interaction.fields.getTextInputValue(
    "correction_suggestion",
  );

  const memberDisplayName =
    ("member" in interaction &&
      interaction.member &&
      (interaction.member as GuildMember).displayName) ||
    interaction.user.globalName ||
    interaction.user.username;

  const suggestionEntry: SuggestionHistoryEntry = {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    displayName: memberDisplayName,
    text: suggestion,
    createdAt: new Date().toISOString(),
  };

  const transcript = await resolveTranscript(history);

  const newNotes = await generateCorrectedNotes({
    currentNotes: history.notes,
    transcript,
    suggestion,
    requesterTag: interaction.user.tag,
    previousSuggestions: history.suggestionsHistory,
  });

  const diff = buildUnifiedDiff(history.notes, newNotes);
  const token = uuidv4();

  pendingCorrections.set(token, {
    guildId,
    channelIdTimestamp,
    channelId: history.channelId,
    notesMessageIds: history.notesMessageIds,
    notesChannelId: history.notesChannelId,
    meetingCreatorId: history.meetingCreatorId,
    isAutoRecording: history.isAutoRecording,
    tags: history.tags,
    summarySentence: history.summarySentence,
    summaryLabel: history.summaryLabel,
    originalNotes: history.notes,
    newNotes,
    notesVersion: history.notesVersion ?? 1,
    requesterId: interaction.user.id,
    suggestion: suggestionEntry,
  });

  const accept = new ButtonBuilder()
    .setCustomId(`${CORRECTION_ACCEPT_PREFIX}:${token}`)
    .setLabel("Accept & update")
    .setStyle(ButtonStyle.Success);

  const reject = new ButtonBuilder()
    .setCustomId(`${CORRECTION_REJECT_PREFIX}:${token}`)
    .setLabel("Reject")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    accept,
    reject,
  );

  await interaction.reply({
    content: `Here's the unified diff between current notes and your proposal:\n\`\`\`\n${diff}\n\`\`\`\nOnly the meeting starter${
      history.isAutoRecording ? " or a server context manager" : ""
    } can accept.`,
    ephemeral: true,
    components: [row],
  });
}

async function applyCorrection(
  interaction: ButtonInteraction,
  pending: PendingCorrection,
): Promise<boolean> {
  const newVersion = (pending.notesVersion ?? 1) + 1;
  const row = buildCorrectionRow(pending.guildId, pending.channelIdTimestamp);
  const { notesBody, summaries } = await buildCorrectionSummaries(
    interaction,
    pending,
  );
  const { newMessageIds, channel } = await updateNotesEmbedsForCorrection(
    interaction,
    pending,
    row,
    notesBody,
    newVersion,
  );
  const updateSucceeded = await persistCorrectionUpdate({
    pending,
    newVersion,
    editedBy: interaction.user.id,
    summaries,
    newMessageIds,
  });

  if (!updateSucceeded) {
    await interaction.update({
      content:
        "Could not apply this correction because the notes were updated elsewhere. Please reopen the correction request and try again.",
      components: [],
    });
    return false;
  }

  // Update succeeded - remove old messages if we posted replacements
  await cleanupOldNotesMessages(
    channel,
    pending.notesMessageIds,
    newMessageIds,
  );

  return true;
}

function resolveChannelName(
  interaction: ButtonInteraction,
  channelId: string,
): string {
  const channel = interaction.guild?.channels.cache.get(channelId);
  return channel?.name ?? channelId;
}

async function buildCorrectionSummaries(
  interaction: ButtonInteraction,
  pending: PendingCorrection,
): Promise<{
  notesBody: string;
  summaries: { summarySentence?: string; summaryLabel?: string };
}> {
  const serverName = interaction.guild?.name ?? "Unknown server";
  const channelName = resolveChannelName(
    interaction,
    pending.channelId ?? pending.channelIdTimestamp.split("#")[0],
  );
  const summaries = await generateMeetingSummaries({
    notes: pending.newNotes,
    serverName,
    channelName,
    tags: pending.tags,
    now: new Date(),
    previousSummarySentence: pending.summarySentence,
    previousSummaryLabel: pending.summaryLabel,
  });
  const summarySentence = summaries.summarySentence ?? pending.summarySentence;
  const summaryLabel = summaries.summaryLabel ?? pending.summaryLabel;
  if (
    !summaries.summarySentence &&
    !summaries.summaryLabel &&
    (pending.summarySentence || pending.summaryLabel)
  ) {
    console.warn(
      "Meeting summary generation returned empty, keeping previous summaries.",
    );
  }
  const notesBody = formatNotesWithSummary(
    pending.newNotes,
    summarySentence,
    summaryLabel,
  );
  return { notesBody, summaries: { summarySentence, summaryLabel } };
}

async function updateNotesEmbedsForCorrection(
  interaction: ButtonInteraction,
  pending: PendingCorrection,
  row: ActionRowBuilder<ButtonBuilder>,
  notesBody: string,
  newVersion: number,
): Promise<{
  newMessageIds?: string[];
  channel: Awaited<ReturnType<typeof interactionChannelFetch>> | null;
}> {
  if (!pending.notesChannelId) {
    return { channel: null };
  }
  const channel = await interactionChannelFetch(
    pending.notesChannelId,
    interaction,
  );
  const existingIds = pending.notesMessageIds ?? [];
  const color = await resolveEmbedColor(channel, existingIds[0]);
  const embeds = buildUpdatedEmbeds(
    notesBody,
    newVersion,
    interaction.user.tag,
    color,
  );
  const newMessageIds = await sendUpdatedEmbeds(channel, embeds, row);
  return { newMessageIds, channel };
}

async function persistCorrectionUpdate(params: {
  pending: PendingCorrection;
  newVersion: number;
  editedBy: string;
  summaries: { summarySentence?: string; summaryLabel?: string };
  newMessageIds?: string[];
}): Promise<boolean> {
  const { pending, newVersion, editedBy, summaries, newMessageIds } = params;
  return updateMeetingNotesService({
    guildId: pending.guildId,
    channelId_timestamp: pending.channelIdTimestamp,
    notes: pending.newNotes,
    notesVersion: newVersion,
    editedBy,
    summarySentence: summaries.summarySentence,
    summaryLabel: summaries.summaryLabel,
    suggestion: pending.suggestion,
    expectedPreviousVersion: pending.notesVersion,
    metadata: {
      notesMessageIds: newMessageIds,
      notesChannelId: pending.notesChannelId,
    },
  });
}

async function cleanupOldNotesMessages(
  channel: Awaited<ReturnType<typeof interactionChannelFetch>> | null,
  existingIds?: string[],
  newMessageIds?: string[],
): Promise<void> {
  if (!channel || !existingIds?.length || !newMessageIds?.length) {
    return;
  }
  try {
    await deleteOldNotesMessages(channel, existingIds);
  } catch (error) {
    console.error("Failed to clean up old notes messages after update:", error);
  }
}

async function getPendingOrNotify(
  interaction: ButtonInteraction,
  token: string,
): Promise<PendingCorrection | undefined> {
  const pending = pendingCorrections.get(token);

  if (!pending) {
    await interaction.reply({
      content: "This correction request has expired.",
      ephemeral: true,
    });
    return undefined;
  }

  return pending;
}

const NOTES_EMBED_TITLE = "Meeting Notes (AI Generated)";

function buildUpdatedEmbeds(
  newNotes: string,
  version: number,
  editedByTag?: string,
  color?: number | null,
) {
  const footerText = editedByTag
    ? `v${version} • Edited by ${editedByTag}`
    : `v${version}`;

  return buildPaginatedEmbeds({
    text: newNotes,
    baseTitle: NOTES_EMBED_TITLE,
    footerText,
    color: color ?? undefined,
  });
}

async function resolveEmbedColor(
  channel: Awaited<ReturnType<typeof interactionChannelFetch>>,
  messageId?: string,
): Promise<number | undefined> {
  if (!messageId || !channel?.isSendable()) return undefined;
  try {
    const first = await channel.messages.fetch(messageId);
    return first.embeds[0]?.color ?? undefined;
  } catch (error) {
    console.error("Failed to fetch existing notes message for color:", error);
    return undefined;
  }
}

async function interactionChannelFetch(
  channelId: string,
  interaction: ButtonInteraction,
) {
  return interaction.client.channels.fetch(channelId);
}

async function sendUpdatedEmbeds(
  channel: Awaited<ReturnType<typeof interactionChannelFetch>>,
  embeds: ReturnType<typeof buildUpdatedEmbeds>,
  row: ActionRowBuilder<ButtonBuilder>,
): Promise<string[] | undefined> {
  if (!channel?.isSendable()) return undefined;
  const sentIds: string[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const msg = await channel.send({
      embeds: [embeds[i]],
      components: i === 0 ? [row] : [],
    });
    sentIds.push(msg.id);
  }
  return sentIds;
}

async function deleteOldNotesMessages(
  channel: Awaited<ReturnType<typeof interactionChannelFetch>>,
  messageIds: string[],
): Promise<void> {
  if (!channel?.isSendable()) return;
  for (const id of messageIds) {
    try {
      const msg = await channel.messages.fetch(id);
      await msg.delete();
    } catch (error) {
      console.error("Failed to delete old notes message after update:", error);
    }
  }
}

async function resolveTranscript(history: MeetingHistory): Promise<string> {
  if (history.transcriptS3Key) {
    const payload = await fetchJsonFromS3<{
      text?: string;
      segments?: Array<{
        userId?: string;
        text?: string;
        username?: string;
        displayName?: string;
        serverNickname?: string;
        tag?: string;
      }>;
    }>(history.transcriptS3Key);
    if (payload?.text) {
      return payload.text;
    }
    if (payload?.segments?.length) {
      return payload.segments
        .filter((segment) => segment.text)
        .map((segment) => {
          const speaker = formatParticipantLabel(
            {
              id: segment.userId ?? "unknown",
              username: segment.username ?? segment.tag ?? "unknown",
              displayName: segment.displayName,
              serverNickname: segment.serverNickname,
              tag: segment.tag,
            },
            {
              includeUsername: true,
              fallbackName:
                segment.serverNickname ||
                segment.displayName ||
                segment.username ||
                segment.tag ||
                "Unknown",
              fallbackUsername: segment.username ?? segment.tag,
            },
          );
          return `${speaker}: ${segment.text}`;
        })
        .join("\n");
    }
  }

  return "";
}

export async function handleNotesCorrectionAccept(
  interaction: ButtonInteraction,
) {
  const [, token] = interaction.customId.split(":");
  const pending = await getPendingOrNotify(interaction, token);
  if (!pending) return;

  if (!canApprove(interaction, pending)) {
    await interaction.reply({
      content:
        "Only the meeting starter (or a context manager for auto-started meetings) can accept corrections.",
      ephemeral: true,
    });
    return;
  }

  const applied = await applyCorrection(interaction, pending);
  if (applied) {
    pendingCorrections.delete(token);

    await interaction.update({
      content: "Correction applied and notes updated.",
      components: [],
    });
  }
}

export async function handleNotesCorrectionReject(
  interaction: ButtonInteraction,
) {
  const [, token] = interaction.customId.split(":");
  const pending = await getPendingOrNotify(interaction, token);
  if (!pending) return;

  const canReject =
    interaction.user.id === pending.requesterId ||
    canApprove(interaction, pending);

  if (!canReject) {
    await interaction.reply({
      content:
        "You don't have permission to reject this correction. Ask the meeting starter or a context manager (auto-record) to handle it.",
      ephemeral: true,
    });
    return;
  }

  pendingCorrections.delete(token);
  await interaction.update({
    content: "Correction rejected.",
    components: [],
  });
}
