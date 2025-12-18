import { ChatInputCommandInteraction } from "discord.js";
import { normalizeTags, parseTags } from "../utils/tags";
import { getGuildLimits } from "../services/subscriptionService";
import { answerQuestionService } from "../services/askService";
import { config } from "../services/configService";

export async function handleAskCommand(
  interaction: ChatInputCommandInteraction,
) {
  const question = interaction.options.getString("question");
  const tagsInput = interaction.options.getString("tags");
  const scope = (interaction.options.getString("scope") || "guild") as
    | "guild"
    | "channel";

  if (!question) {
    await interaction.reply({
      content: "Please provide a question.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const { limits } = await getGuildLimits(interaction.guildId);
    const maxMeetings = limits.maxAskMeetings ?? config.ask.maxMeetings;

    const { answer } = await answerQuestionService({
      guildId: interaction.guildId!,
      channelId: interaction.channelId!,
      question,
      tags: normalizeTags(parseTags(tagsInput)),
      scope,
      maxMeetings,
    });

    await interaction.editReply(answer);
  } catch (error) {
    console.error("Error handling /ask:", error);
    await interaction.editReply("Error answering that question.");
  }
}
