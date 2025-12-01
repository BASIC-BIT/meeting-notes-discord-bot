import { MeetingData } from "../types/meeting-data";
import { MeetingHistory } from "../types/db";
import { writeMeetingHistory } from "../db";
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
    let notes: string | undefined;

    if (meeting.generateNotes) {
      try {
        // Notes now encompass everything (summary, action items, etc.)
        notes = await getNotes(meeting);
      } catch (error) {
        console.error("Error generating notes for meeting history:", error);
        // Continue saving history even if AI generation fails
      }
    }

    const history: MeetingHistory = {
      guildId: meeting.guildId,
      channelId_timestamp: `${meeting.voiceChannel.id}#${timestamp}`,
      meetingId: meeting.meetingId,
      channelId: meeting.voiceChannel.id,
      timestamp,
      notes,
      context: meeting.meetingContext,
      attendees: Array.from(meeting.attendance),
      duration,
      transcribeMeeting: meeting.transcribeMeeting,
      generateNotes: meeting.generateNotes,
      meetingCreatorId: meeting.creator.id,
      isAutoRecording: meeting.isAutoRecording,
      notesMessageId: meeting.notesMessageId,
      notesChannelId: meeting.notesChannelId,
      notesVersion: meeting.notesVersion,
      notesLastEditedBy: meeting.notesLastEditedBy,
      notesLastEditedAt: meeting.notesVersion ? timestamp : undefined,
      transcript: meeting.finalTranscript,
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
