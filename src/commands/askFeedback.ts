import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { submitAskFeedback } from "../services/askFeedbackService";
import { MAX_FEEDBACK_COMMENT_LENGTH } from "../services/feedbackHelpers";

const ASK_FEEDBACK_UP = "ask_feedback_up";
const ASK_FEEDBACK_DOWN = "ask_feedback_down";
const ASK_FEEDBACK_MODAL_PREFIX = "ask_feedback_modal";
const ASK_FEEDBACK_FIELD_ID = "ask_feedback_comment";

const extractMessageId = (customId: string): string | undefined => {
  const parts = customId.split(":");
  if (parts.length < 2) return undefined;
  return parts[1];
};

const resolveDisplayName = (interaction: {
  guild?: { members: { cache: Map<string, { displayName?: string }> } } | null;
  user: { id: string; globalName?: string | null; username: string };
}) => {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  return (
    member?.displayName ??
    interaction.user.globalName ??
    interaction.user.username
  );
};

export function buildAskFeedbackRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ASK_FEEDBACK_UP)
      .setLabel("Helpful")
      .setEmoji("\u{1F44D}")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(ASK_FEEDBACK_DOWN)
      .setLabel("Needs work")
      .setEmoji("\u{1F914}")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function isAskFeedbackUp(customId: string): boolean {
  return customId === ASK_FEEDBACK_UP;
}

export function isAskFeedbackDown(customId: string): boolean {
  return customId === ASK_FEEDBACK_DOWN;
}

export function isAskFeedbackModal(customId: string): boolean {
  return customId.startsWith(`${ASK_FEEDBACK_MODAL_PREFIX}:`);
}

export async function handleAskFeedbackUp(interaction: ButtonInteraction) {
  const messageId = interaction.message?.id;
  const channelId = interaction.channelId ?? undefined;
  if (!messageId || !interaction.guildId || !channelId) {
    await interaction.reply({
      content: "Unable to record feedback for this response.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await submitAskFeedback({
    guildId: interaction.guildId,
    channelId,
    messageId,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    displayName: resolveDisplayName(interaction),
    rating: "up",
    source: "discord",
  });

  await interaction.editReply("Thanks for the feedback.");
}

export async function handleAskFeedbackDown(interaction: ButtonInteraction) {
  const messageId = interaction.message?.id;
  if (!messageId || !interaction.guildId || !interaction.channelId) {
    await interaction.reply({
      content: "Unable to open feedback form.",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ASK_FEEDBACK_MODAL_PREFIX}:${messageId}`)
    .setTitle("Ask feedback");

  const feedbackInput = new TextInputBuilder()
    .setCustomId(ASK_FEEDBACK_FIELD_ID)
    .setLabel("What could be better? (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_FEEDBACK_COMMENT_LENGTH)
    .setPlaceholder("Share details to help improve the answer.");

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
    feedbackInput,
  );
  modal.addComponents(row);

  await interaction.showModal(modal);
}

export async function handleAskFeedbackModal(
  interaction: ModalSubmitInteraction,
) {
  const messageId = extractMessageId(interaction.customId);
  const channelId = interaction.channelId ?? undefined;
  if (!messageId || !interaction.guildId || !channelId) {
    await interaction.reply({
      content: "Unable to record feedback for this response.",
      ephemeral: true,
    });
    return;
  }

  const comment = interaction.fields.getTextInputValue(ASK_FEEDBACK_FIELD_ID);

  await interaction.deferReply({ ephemeral: true });
  await submitAskFeedback({
    guildId: interaction.guildId,
    channelId,
    messageId,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    displayName: resolveDisplayName(interaction),
    rating: "down",
    comment,
    source: "discord",
  });

  await interaction.editReply("Thanks for the feedback.");
}
