import type { AudioCueEvent, AudioFileData } from "../types/audio";
import type { MeetingData } from "../types/meeting-data";
import type {
  LiveMeetingMeta,
  LiveMeetingSegment,
  LiveMeetingStatus,
} from "../types/liveMeeting";

const resolveSegmentSource = (
  source?: AudioFileData["source"],
): LiveMeetingSegment["source"] => {
  if (source === "chat_tts" || source === "bot") {
    return source;
  }
  return "voice";
};

const resolveCueSource = (
  source?: AudioCueEvent["source"],
): LiveMeetingSegment["source"] => {
  if (source === "chat_tts" || source === "bot") {
    return source;
  }
  return "bot";
};

const buildSegmentId = (
  source: LiveMeetingSegment["source"],
  userId: string,
  timestamp: number,
  messageId?: string,
) => `${source}:${userId}:${timestamp}:${messageId ?? ""}`;

const resolveOptionalLabel = (value?: string | null) => value ?? undefined;

const resolveParticipant = (meeting: MeetingData, userId: string) => {
  const participant = meeting.participants.get(userId);
  if (participant) {
    return {
      username: participant.username,
      displayName: participant.displayName,
      serverNickname: participant.serverNickname,
      tag: participant.tag,
    };
  }
  const member = meeting.guild.members.cache.get(userId);
  const user = meeting.guild.client.users.cache.get(userId);
  return {
    username: user?.username,
    displayName: resolveOptionalLabel(user?.globalName ?? user?.username),
    serverNickname: resolveOptionalLabel(member?.nickname),
    tag: user?.tag,
  };
};

const buildSegmentFromAudioFile = (
  meeting: MeetingData,
  file: AudioFileData,
): LiveMeetingSegment | null => {
  if (!file.transcript || !file.transcript.trim()) return null;
  const source = resolveSegmentSource(file.source);
  const timestamp = file.timestamp;
  const participant = resolveParticipant(meeting, file.userId);
  return {
    id: buildSegmentId(source, file.userId, timestamp, file.messageId),
    userId: file.userId,
    username: participant.username,
    displayName: participant.displayName,
    serverNickname: participant.serverNickname,
    tag: participant.tag,
    startedAt: new Date(timestamp).toISOString(),
    text: file.transcript,
    source,
    messageId: file.messageId,
  };
};

const buildSegmentFromCue = (
  meeting: MeetingData,
  cue: AudioCueEvent,
): LiveMeetingSegment | null => {
  if (!cue.text || !cue.text.trim()) return null;
  const source = resolveCueSource(cue.source);
  const timestamp = cue.timestamp;
  const participant = resolveParticipant(meeting, cue.userId);
  return {
    id: buildSegmentId(source, cue.userId, timestamp),
    userId: cue.userId,
    username: participant.username,
    displayName: participant.displayName,
    serverNickname: participant.serverNickname,
    tag: participant.tag,
    startedAt: new Date(timestamp).toISOString(),
    text: cue.text,
    source,
  };
};

export function buildLiveMeetingSegments(
  meeting: MeetingData,
): LiveMeetingSegment[] {
  const segments: LiveMeetingSegment[] = [];
  for (const file of meeting.audioData.audioFiles) {
    const segment = buildSegmentFromAudioFile(meeting, file);
    if (segment) segments.push(segment);
  }
  if (meeting.audioData.cueEvents) {
    for (const cue of meeting.audioData.cueEvents) {
      const segment = buildSegmentFromCue(meeting, cue);
      if (segment) segments.push(segment);
    }
  }
  segments.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return segments;
}

export function buildLiveMeetingMeta(meeting: MeetingData): LiveMeetingMeta {
  const status: LiveMeetingStatus = meeting.finished
    ? "complete"
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
