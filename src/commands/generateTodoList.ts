import {getTodoList} from "../transcription";
import {ButtonInteraction, EmbedBuilder} from "discord.js";
import {getMeeting} from "../meetings";

export async function generateAndSendTodoList(interaction: ButtonInteraction) {
    const meeting = getMeeting(interaction.guildId!);

    if(!meeting) {
        await interaction.reply("Meeting data has already been cleaned up, sorry!");
        return;
    }

    await interaction.deferReply();

    const todoList = await getTodoList(meeting);

    if(todoList && todoList.length) {
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Meeting Todo List")
                    .setDescription(todoList)
            ],
        });
    } else {
        await interaction.editReply({
            content: "No action items detected within transcript."
        });
    }
}