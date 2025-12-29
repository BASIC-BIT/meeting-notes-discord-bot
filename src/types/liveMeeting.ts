export type LiveMeetingStatus = "in_progress" | "complete";

export type LiveMeetingSegment = {
  id: string;
  userId: string;
  username?: string;
  displayName?: string;
  serverNickname?: string;
  tag?: string;
  startedAt: string;
  text: string;
  source: "voice" | "chat_tts" | "bot";
  messageId?: string;
};

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
  segments: LiveMeetingSegment[];
};

export type LiveMeetingSegmentsPayload = {
  segments: LiveMeetingSegment[];
};

export type LiveMeetingStatusPayload = {
  status: LiveMeetingStatus;
  endedAt?: string;
};
