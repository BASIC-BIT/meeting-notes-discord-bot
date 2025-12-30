import type { MeetingData } from "../types/meeting-data";
import type { LiveMeetingMeta, LiveMeetingStatus } from "../types/liveMeeting";
import { resolveMeetingStatus } from "../types/meetingLifecycle";

export function buildLiveMeetingMeta(meeting: MeetingData): LiveMeetingMeta {
  const status: LiveMeetingStatus = resolveMeetingStatus({
    cancelled: meeting.cancelled,
    finished: meeting.finished,
    finishing: meeting.finishing,
  });
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
