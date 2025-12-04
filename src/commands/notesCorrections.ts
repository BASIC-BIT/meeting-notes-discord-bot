import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { diffLines } from "diff";
import { v4 as uuidv4 } from "uuid";
import { getMeetingHistory, updateMeetingNotes } from "../db";
import OpenAI from "openai";
import { config } from "../services/configService";
import { stripCodeFences } from "../utils/text";
import { buildPaginatedEmbeds } from "../utils/embedPagination";
import { MeetingHistory, SuggestionHistoryEntry } from "../types/db";
import { fetchTranscriptFromS3 } from "../services/storageService";

type PendingCorrection = {
  guildId: string;
  channelIdTimestamp: string;
  notesMessageId?: string;
  notesChannelId?: string;
  meetingCreatorId?: string;
  isAutoRecording?: boolean;
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

const openAIClient = new OpenAI({
  apiKey: config.openai.apiKey,
  organization: config.openai.organizationId,
  project: config.openai.projectId,
});

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
    .slice(-10) // Keep it compact
    .map(
      (entry) =>
        `- [${new Date(entry.createdAt).toLocaleString()}] ${entry.userId}: ${entry.text}`,
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
  const systemPrompt =
    "You are updating meeting notes. Given the current notes, the full transcript, and a user suggestion, make the smallest edits needed to satisfy the suggestion while preserving the existing structure and sections. Do NOT append or copy the transcript into the notes. Keep all other content unchanged. Return the full revised notes as markdown.";

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
    const completion = await openAIClient.chat.completions.create({
      model: "gpt-5.1",
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

  const history = await getMeetingHistory(guildId, channelIdTimestamp);

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

  const suggestionEntry: SuggestionHistoryEntry = {
    userId: interaction.user.id,
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
    notesMessageId: history.notesMessageId,
    notesChannelId: history.notesChannelId,
    meetingCreatorId: history.meetingCreatorId,
    isAutoRecording: history.isAutoRecording,
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

  const updateSucceeded = await updateMeetingNotes(
    pending.guildId,
    pending.channelIdTimestamp,
    pending.newNotes,
    newVersion,
    interaction.user.id,
    pending.suggestion,
    pending.notesVersion,
  );

  if (!updateSucceeded) {
    await interaction.update({
      content:
        "Could not apply this correction because the notes were updated elsewhere. Please reopen the correction request and try again.",
      components: [],
    });
    return false;
  }

  if (pending.notesChannelId && pending.notesMessageId) {
    const channel = await interaction.client.channels.fetch(
      pending.notesChannelId,
    );

    if (channel && channel.isTextBased()) {
      try {
        const message = await channel.messages.fetch(pending.notesMessageId);
        const color = message.embeds[0]?.color ?? undefined;
        const embeds = buildUpdatedEmbeds(
          pending.newNotes,
          newVersion,
          interaction.user.tag,
          color,
        );

        await message.edit({
          embeds,
          components: [row],
        });
      } catch (error) {
        console.error("Failed to edit notes message:", error);
      }
    }
  }

  return true;
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

async function resolveTranscript(history: MeetingHistory): Promise<string> {
  if (history.transcriptS3Key) {
    const fromS3 = await fetchTranscriptFromS3(history.transcriptS3Key);
    if (fromS3) {
      return fromS3;
    }
  }

  if (history.transcript && history.transcript.length > 0) {
    return history.transcript;
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
