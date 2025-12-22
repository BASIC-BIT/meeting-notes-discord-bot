import { MeetingData } from "../types/meeting-data";
import { MeetingHistory } from "../types/db";
import { writeMeetingHistoryService } from "../services/meetingHistoryService";
import { getNotes } from "../transcription";

export async function saveMeetingHistoryToDatabase(meeting: MeetingData) {
  // Only save if transcription was enabled (we need something to save)
  if (!meeting.transcribeMeeting || !meeting.finalTranscript) {
    return;
  }

  try {
    const timestamp = meeting.startTime.toISOString();
    const duration = meeting.endTime
      ? Math.floor(
          (meeting.endTime.getTime() - meeting.startTime.getTime()) / 1000,
        )
      : 0;

    // Generate notes if enabled
    let notes: string | undefined = meeting.notesText;

    if (meeting.generateNotes && !notes) {
      try {
        // Notes now encompass everything (summary, action items, etc.)
        notes = await getNotes(meeting);
        meeting.notesText = notes;
      } catch (error) {
        console.error("Error generating notes for meeting history:", error);
        // Continue saving history even if AI generation fails
      }
    }

    const transcriptS3Key = meeting.transcriptS3Key;

    const notesVersion = meeting.notesVersion ?? (notes ? 1 : undefined);
    const notesLastEditedBy =
      meeting.notesLastEditedBy ?? (notes ? meeting.creator.id : undefined);
    const notesLastEditedAt =
      meeting.notesLastEditedAt ??
      (notesVersion
        ? (meeting.endTime?.toISOString() ?? timestamp)
        : undefined);

    const notesHistory =
      notes && notesVersion
        ? [
            {
              version: notesVersion,
              notes,
              editedBy: notesLastEditedBy ?? meeting.creator.id,
              editedAt: notesLastEditedAt ?? timestamp,
            },
          ]
        : undefined;

    const history: MeetingHistory = {
      guildId: meeting.guildId,
      channelId_timestamp: `${meeting.voiceChannel.id}#${timestamp}`,
      meetingId: meeting.meetingId,
      channelId: meeting.voiceChannel.id,
      timestamp,
      tags: meeting.tags,
      notes,
      context: meeting.meetingContext,
      participants: Array.from(meeting.participants.values()),
      duration,
      transcribeMeeting: meeting.transcribeMeeting,
      generateNotes: meeting.generateNotes,
      meetingCreatorId: meeting.creator.id,
      isAutoRecording: meeting.isAutoRecording,
      notesMessageIds: meeting.notesMessageIds,
      notesChannelId: meeting.notesChannelId,
      notesVersion,
      notesLastEditedBy,
      notesLastEditedAt,
      notesHistory,
      transcriptS3Key,
      audioS3Key: meeting.audioS3Key,
      chatS3Key: meeting.chatS3Key,
    };

    await writeMeetingHistoryService(history);
    console.log(
      `Meeting history saved for guild ${meeting.guildId}, channel ${meeting.voiceChannel.id}`,
    );
  } catch (error) {
    console.error("Failed to save meeting history:", error);
    // Don't throw - we don't want to fail the meeting end process if history save fails
  }
}
