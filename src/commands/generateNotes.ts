import { EmbedBuilder } from "discord.js";
import { getNotes } from "../transcription";
import { MeetingData } from "../types/meeting-data";

export async function generateAndSendNotes(meeting: MeetingData) {
  // const [notes, image] = await Promise.all([getNotes(meeting), getImage(meeting)]);
  const notes = await getNotes(meeting);

  if (notes && notes.length) {
    await meeting.textChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Meeting Notes (AI Generated)")
          .setDescription(notes),
        // .setImage(image)
      ],
    });
  }
}
