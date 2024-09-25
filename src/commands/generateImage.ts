import { getImage } from "../transcription";
import { ButtonInteraction, EmbedBuilder } from "discord.js";
import { getMeeting } from "../meetings";

export async function generateAndSendImage(interaction: ButtonInteraction) {
  const meeting = getMeeting(interaction.guildId!);

  if (!meeting) {
    await interaction.reply("Meeting data has already been cleaned up, sorry!");
    return;
  }

  await interaction.deferReply();

  const imageUrl = await getImage(meeting);

  if (imageUrl) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Meeting Image").setImage(imageUrl)],
    });
  } else {
    await interaction.editReply({
      content: "No action items detected within transcript.",
    });
  }
}
