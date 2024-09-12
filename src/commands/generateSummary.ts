import {ButtonInteraction, EmbedBuilder} from "discord.js";
import {getSummary} from "../transcription";
import {getMeeting} from "../meetings";

export async function generateAndSendSummary(interaction: ButtonInteraction) {
    const meeting = getMeeting(interaction.guildId!);

    if(!meeting) {
        await interaction.reply("Meeting data has already been cleaned up, sorry!");
        return;
    }

    await interaction.deferReply();

    const summary = await getSummary(meeting);

    if(summary && summary.length) {
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Meeting Summary")
                    .setDescription(summary)
            ],
        });
    }
}