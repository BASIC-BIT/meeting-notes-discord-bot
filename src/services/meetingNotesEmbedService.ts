import {
  formatNotesEmbedTitle,
  resolveNotesEmbedBaseTitle,
} from "../utils/meetingNotes";
import { config } from "./configService";
import {
  fetchDiscordMessage,
  updateDiscordMessageEmbeds,
} from "./discordMessageService";

export async function updateMeetingNotesEmbedTitles(params: {
  notesChannelId?: string;
  notesMessageIds?: string[];
  meetingName: string;
}) {
  if (config.mock.enabled) return;
  const { notesChannelId, notesMessageIds, meetingName } = params;
  if (!notesChannelId || !notesMessageIds?.length) return;

  const baseTitle = resolveNotesEmbedBaseTitle(meetingName);
  const total = notesMessageIds.length;

  for (let index = 0; index < notesMessageIds.length; index += 1) {
    const messageId = notesMessageIds[index];
    try {
      const message = await fetchDiscordMessage(notesChannelId, messageId);
      const embed = message?.embeds?.[0];
      if (!embed) continue;
      const title = formatNotesEmbedTitle(baseTitle, index, total);
      await updateDiscordMessageEmbeds(notesChannelId, messageId, [
        {
          ...embed,
          title,
        },
      ]);
    } catch (error) {
      console.warn(
        "Failed to update notes embed title for meeting name",
        error,
      );
    }
  }
}
