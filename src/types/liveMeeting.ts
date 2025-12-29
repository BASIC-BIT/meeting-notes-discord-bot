import type { MeetingEvent } from "./meetingTimeline";

export type LiveMeetingStatus = "in_progress" | "processing" | "complete";

export type LiveMeetingMeta = {
  guildId: string;
  meetingId: string;
  channelId: string;
  channelName: string;
  startedAt: string;
  isAutoRecording: boolean;
  status: LiveMeetingStatus;
  attendees: string[];
};

export type LiveMeetingInitPayload = {
  meeting: LiveMeetingMeta;
  events: MeetingEvent[];
};

export type LiveMeetingEventsPayload = {
  events: MeetingEvent[];
};

export type LiveMeetingAttendeesPayload = {
  attendees: string[];
};

export type LiveMeetingStatusPayload = {
  status: LiveMeetingStatus;
  endedAt?: string;
};
