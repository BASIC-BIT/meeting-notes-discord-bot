import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../services/configService";
import { resolveGuildSubscription } from "../services/subscriptionService";

export const billingCommand = new SlashCommandBuilder()
  .setName("billing")
  .setDescription("View your subscription status and upgrade options (guild)");

export async function handleBillingCommand(
  interaction: ChatInputCommandInteraction,
) {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId) {
    await interaction.editReply("This command must be run in a server.");
    return;
  }

  const subscription = await resolveGuildSubscription(interaction.guildId);

  const lines = [
    `Tier: **${subscription.tier}**`,
    `Status: ${subscription.status}`,
    `Stripe mode: ${config.subscription.stripeMode || "live"}`,
  ];

  const components: ButtonBuilder[] = [];
  if (config.stripe.billingLandingUrl) {
    components.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(subscription.tier === "free" ? "Upgrade" : "Upgrade/Change")
        .setURL(config.stripe.billingLandingUrl),
    );
  }

  const row =
    components.length > 0
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(components)
      : undefined;

  await interaction.editReply({
    content: lines.join("\n"),
    components: row ? [row] : [],
  });
}
