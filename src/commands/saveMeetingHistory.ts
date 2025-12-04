import { MeetingData } from "../types/meeting-data";
import { MeetingHistory } from "../types/db";
import { writeMeetingHistory } from "../db";
import { getNotes } from "../transcription";
import { uploadTranscriptToS3 } from "../services/storageService";

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

    // Upload full transcript to S3
    let transcriptS3Key: string | undefined;

    if (meeting.finalTranscript) {
      transcriptS3Key = await uploadTranscriptToS3({
        guildId: meeting.guildId,
        channelId: meeting.voiceChannel.id,
        timestamp,
        transcript: meeting.finalTranscript,
      });

      meeting.transcriptS3Key = transcriptS3Key;
    }

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
      notes,
      context: meeting.meetingContext,
      participants: Array.from(meeting.participants.values()),
      duration,
      transcribeMeeting: meeting.transcribeMeeting,
      generateNotes: meeting.generateNotes,
      meetingCreatorId: meeting.creator.id,
      isAutoRecording: meeting.isAutoRecording,
      notesMessageId: meeting.notesMessageId,
      notesChannelId: meeting.notesChannelId,
      notesVersion,
      notesLastEditedBy,
      notesLastEditedAt,
      notesHistory,
      transcriptS3Key,
      audioS3Key: meeting.audioS3Key,
      chatS3Key: meeting.chatS3Key,
    };

    await writeMeetingHistory(history);
    console.log(
      `Meeting history saved for guild ${meeting.guildId}, channel ${meeting.voiceChannel.id}`,
    );
  } catch (error) {
    console.error("Failed to save meeting history:", error);
    // Don't throw - we don't want to fail the meeting end process if history save fails
  }
}
