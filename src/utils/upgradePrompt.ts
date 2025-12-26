import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionReplyOptions,
} from "discord.js";
import { config } from "../services/configService";

export function buildUpgradePrompt(
  content: string,
): InteractionReplyOptions & { ephemeral?: boolean } {
  const upgradeBtn =
    config.stripe.billingLandingUrl &&
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Upgrade")
      .setURL(config.stripe.billingLandingUrl);

  return {
    content,
    components: upgradeBtn
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(upgradeBtn)]
      : [],
    ephemeral: true,
  };
}

export function buildUpgradeTextOnly(content: string): string {
  const link = config.stripe.billingLandingUrl;
  if (!link) return content;
  return `${content}\nUpgrade: ${link}`;
}
