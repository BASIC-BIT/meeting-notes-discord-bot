import {ButtonInteraction, EmbedBuilder} from "discord.js";
import { getNotes } from "../transcription";
import {getMeeting} from "../meetings";

export async function generateAndSendNotes(interaction: ButtonInteraction) {
    const meeting = getMeeting(interaction.guildId!);

    if(!meeting) {
        await interaction.reply("Meeting data has already been cleaned up, sorry!");
        return;
    }

    await interaction.deferReply();

    const notes = await getNotes(meeting);

    if(notes && notes.length) {
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Meeting Notes")
                    .setDescription(notes)
            ],
        });
    }
}