import type { MeetingData } from "../types/meeting-data";
import type { LiveMeetingMeta, LiveMeetingStatus } from "../types/liveMeeting";

export function buildLiveMeetingMeta(meeting: MeetingData): LiveMeetingMeta {
  const status: LiveMeetingStatus = meeting.finished
    ? "complete"
    : meeting.finishing
      ? "processing"
      : "in_progress";
  return {
    guildId: meeting.guildId,
    meetingId: meeting.meetingId,
    channelId: meeting.voiceChannel.id,
    channelName: meeting.voiceChannel.name,
    startedAt: meeting.startTime.toISOString(),
    isAutoRecording: meeting.isAutoRecording,
    status,
    attendees: Array.from(meeting.attendance),
  };
}
