import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { submitMeetingSummaryFeedback } from "../services/summaryFeedbackService";

const SUMMARY_FEEDBACK_UP_PREFIX = "summary_feedback_up";
const SUMMARY_FEEDBACK_DOWN_PREFIX = "summary_feedback_down";
const SUMMARY_FEEDBACK_MODAL_PREFIX = "summary_feedback_modal";

const SUMMARY_FEEDBACK_FIELD_ID = "summary_feedback_comment";
const MAX_FEEDBACK_COMMENT_LENGTH = 1000;

function encodeKey(channelIdTimestamp: string): string {
  return Buffer.from(channelIdTimestamp).toString("base64");
}

function decodeKey(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}

function extractEncodedKey(customId: string): string | undefined {
  const parts = customId.split(":");
  if (parts.length < 2) return undefined;
  return parts[1];
}

function resolveDisplayName(interaction: {
  guild?: { members: { cache: Map<string, { displayName?: string }> } } | null;
  user: { id: string; globalName?: string | null; username: string };
}) {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  return (
    member?.displayName ??
    interaction.user.globalName ??
    interaction.user.username
  );
}

export function isSummaryFeedbackUp(customId: string): boolean {
  return customId.startsWith(`${SUMMARY_FEEDBACK_UP_PREFIX}:`);
}

export function isSummaryFeedbackDown(customId: string): boolean {
  return customId.startsWith(`${SUMMARY_FEEDBACK_DOWN_PREFIX}:`);
}

export function isSummaryFeedbackModal(customId: string): boolean {
  return customId.startsWith(`${SUMMARY_FEEDBACK_MODAL_PREFIX}:`);
}

export async function handleSummaryFeedbackUp(interaction: ButtonInteraction) {
  const encodedKey = extractEncodedKey(interaction.customId);
  if (!encodedKey || !interaction.guildId) {
    await interaction.reply({
      content: "Unable to record feedback for this summary.",
      ephemeral: true,
    });
    return;
  }

  let channelIdTimestamp: string;
  try {
    channelIdTimestamp = decodeKey(encodedKey);
  } catch {
    await interaction.reply({
      content: "Unable to decode feedback request.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await submitMeetingSummaryFeedback({
    guildId: interaction.guildId,
    channelIdTimestamp,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    displayName: resolveDisplayName(interaction),
    rating: "up",
  });

  await interaction.editReply("Thanks for the feedback.");
}

export async function handleSummaryFeedbackDown(
  interaction: ButtonInteraction,
) {
  const encodedKey = extractEncodedKey(interaction.customId);
  if (!encodedKey) {
    await interaction.reply({
      content: "Unable to open feedback form.",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${SUMMARY_FEEDBACK_MODAL_PREFIX}:${encodedKey}`)
    .setTitle("Summary feedback");

  const feedbackInput = new TextInputBuilder()
    .setCustomId(SUMMARY_FEEDBACK_FIELD_ID)
    .setLabel("What could be better? (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_FEEDBACK_COMMENT_LENGTH)
    .setPlaceholder("Add any detail that helps improve the summary.");

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
    feedbackInput,
  );
  modal.addComponents(row);

  await interaction.showModal(modal);
}

export async function handleSummaryFeedbackModal(
  interaction: ModalSubmitInteraction,
) {
  const encodedKey = extractEncodedKey(interaction.customId);
  if (!encodedKey || !interaction.guildId) {
    await interaction.reply({
      content: "Unable to record feedback for this summary.",
      ephemeral: true,
    });
    return;
  }

  let channelIdTimestamp: string;
  try {
    channelIdTimestamp = decodeKey(encodedKey);
  } catch {
    await interaction.reply({
      content: "Unable to decode feedback request.",
      ephemeral: true,
    });
    return;
  }

  const comment = interaction.fields.getTextInputValue(
    SUMMARY_FEEDBACK_FIELD_ID,
  );

  await interaction.deferReply({ ephemeral: true });
  await submitMeetingSummaryFeedback({
    guildId: interaction.guildId,
    channelIdTimestamp,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    displayName: resolveDisplayName(interaction),
    rating: "down",
    comment,
  });

  await interaction.editReply("Thanks for the feedback.");
}

export function buildSummaryFeedbackButtonIds(channelIdTimestamp: string) {
  const encodedKey = encodeKey(channelIdTimestamp);
  return {
    up: `${SUMMARY_FEEDBACK_UP_PREFIX}:${encodedKey}`,
    down: `${SUMMARY_FEEDBACK_DOWN_PREFIX}:${encodedKey}`,
  };
}
