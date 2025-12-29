import type { AudioCueEvent, AudioFileData } from "../types/audio";
import type { ChatEntry } from "../types/chat";
import type { MeetingHistory } from "../types/db";
import type { MeetingData } from "../types/meeting-data";
import type { MeetingEvent } from "../types/meetingTimeline";
import type { Participant } from "../types/participants";
import type { TranscriptPayload, TranscriptSegment } from "../types/transcript";

type EventWithSeconds = {
  seconds: number;
  event: MeetingEvent;
};

const formatElapsed = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      secs,
    ).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
};

const resolveParticipantLabel = (
  participant?: Participant,
  fallback?: string,
) =>
  participant?.serverNickname ||
  participant?.displayName ||
  participant?.username ||
  participant?.tag ||
  fallback ||
  "Unknown";

const resolveSegmentSpeaker = (segment: TranscriptSegment) =>
  segment.serverNickname ||
  segment.displayName ||
  segment.username ||
  segment.tag ||
  "Unknown";

const buildEventId = (
  type: MeetingEvent["type"],
  parts: Array<string | number | undefined>,
) => {
  const cleaned = parts
    .filter((part) => part !== undefined && part !== "")
    .map((part) => String(part));
  return [type, ...cleaned].join(":");
};

const addEvent = (
  events: EventWithSeconds[],
  seconds: number,
  event: MeetingEvent,
) => {
  events.push({ seconds, event });
};

const toSeconds = (value: number | string | Date, fallbackSeconds = 0) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallbackSeconds;
  }
  const parsed = Date.parse(
    value instanceof Date ? value.toISOString() : value,
  );
  if (!Number.isFinite(parsed)) return fallbackSeconds;
  return parsed;
};

const sortEvents = (events: EventWithSeconds[]) =>
  events.sort((a, b) => a.seconds - b.seconds).map((item) => item.event);

const buildNotesPostedEvent = (
  events: EventWithSeconds[],
  meetingStartMs: number,
  timestamp: string | undefined,
  durationSeconds: number,
  idSuffix: string | undefined,
) => {
  const timeSeconds = timestamp
    ? (Date.parse(timestamp) - meetingStartMs) / 1000
    : durationSeconds;
  const safeSeconds = Number.isFinite(timeSeconds)
    ? timeSeconds
    : durationSeconds;
  addEvent(events, safeSeconds, {
    id: buildEventId("bot", ["notes", idSuffix ?? "posted"]),
    type: "bot",
    time: formatElapsed(safeSeconds),
    speaker: "Chronote",
    text: "Meeting summary posted to Discord.",
  });
};

const buildTranscriptEvents = (
  events: EventWithSeconds[],
  transcriptSegments: TranscriptSegment[],
  transcriptText: string | undefined,
  meetingStartMs: number,
) => {
  const spokenChatIds = new Set<string>();
  if (transcriptSegments.length === 0 && !transcriptText?.trim()) {
    addEvent(events, 0, {
      id: buildEventId("bot", ["transcript-unavailable"]),
      type: "bot",
      time: formatElapsed(0),
      text: "Transcript unavailable.",
    });
    return spokenChatIds;
  }

  for (const segment of transcriptSegments) {
    if (!segment.text) continue;
    const startedAtMs = toSeconds(segment.startedAt, meetingStartMs);
    const elapsedSeconds = (startedAtMs - meetingStartMs) / 1000;
    const seconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    if (segment.source === "chat_tts") {
      if (segment.messageId) {
        spokenChatIds.add(segment.messageId);
      }
      addEvent(events, seconds, {
        id: buildEventId("tts", [
          segment.userId,
          segment.startedAt,
          segment.messageId,
        ]),
        type: "tts",
        time: formatElapsed(seconds),
        speaker: resolveSegmentSpeaker(segment),
        text: segment.text,
        messageId: segment.messageId,
      });
      continue;
    }
    if (segment.source === "bot") {
      addEvent(events, seconds, {
        id: buildEventId("bot", [segment.userId, segment.startedAt]),
        type: "bot",
        time: formatElapsed(seconds),
        text: segment.text,
      });
      continue;
    }
    addEvent(events, seconds, {
      id: buildEventId("voice", [segment.userId, segment.startedAt]),
      type: "voice",
      time: formatElapsed(seconds),
      speaker: resolveSegmentSpeaker(segment),
      text: segment.text,
    });
  }

  return spokenChatIds;
};

const buildChatEvents = (
  events: EventWithSeconds[],
  chatEntries: ChatEntry[] | undefined,
  meetingStartMs: number,
  spokenChatIds: Set<string>,
) => {
  for (const entry of chatEntries ?? []) {
    if (entry.messageId && spokenChatIds.has(entry.messageId)) {
      continue;
    }
    const startedAtMs = toSeconds(entry.timestamp, meetingStartMs);
    const elapsedSeconds = (startedAtMs - meetingStartMs) / 1000;
    const seconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    if (entry.type === "message") {
      if (!entry.content) continue;
      addEvent(events, seconds, {
        id: buildEventId("chat", [
          entry.user.id,
          entry.messageId ?? entry.timestamp,
        ]),
        type: "chat",
        time: formatElapsed(seconds),
        speaker: resolveParticipantLabel(entry.user),
        text: entry.content,
        messageId: entry.messageId,
      });
      continue;
    }
    addEvent(events, seconds, {
      id: buildEventId("presence", [
        entry.user.id,
        entry.type,
        entry.timestamp,
      ]),
      type: "presence",
      time: formatElapsed(seconds),
      speaker: resolveParticipantLabel(entry.user),
      text: entry.type === "join" ? "joined the channel" : "left the channel",
    });
  }
};

export function buildMeetingTimelineEventsFromHistory(options: {
  history: MeetingHistory;
  transcriptPayload?: TranscriptPayload;
  chatEntries?: ChatEntry[];
}): MeetingEvent[] {
  const { history, transcriptPayload, chatEntries } = options;
  const meetingStartMs = Date.parse(history.timestamp);
  const events: EventWithSeconds[] = [];

  const transcriptSegments = transcriptPayload?.segments ?? [];
  const spokenChatIds = buildTranscriptEvents(
    events,
    transcriptSegments,
    transcriptPayload?.text,
    meetingStartMs,
  );
  buildChatEvents(events, chatEntries, meetingStartMs, spokenChatIds);

  if (history.notesChannelId) {
    buildNotesPostedEvent(
      events,
      meetingStartMs,
      history.notesLastEditedAt ?? history.updatedAt,
      history.duration,
      history.notesMessageIds?.[0],
    );
  }

  return sortEvents(events);
}

const resolveLiveSpeaker = (meeting: MeetingData, userId: string) => {
  const participant = meeting.participants.get(userId);
  if (participant) {
    return resolveParticipantLabel(participant);
  }
  const member = meeting.guild.members.cache.get(userId);
  const user = meeting.guild.client.users.cache.get(userId);
  return (
    member?.nickname ||
    user?.globalName ||
    user?.username ||
    user?.tag ||
    "Unknown"
  );
};

const buildTranscriptSegmentsFromMeeting = (meeting: MeetingData) => {
  const segments: TranscriptSegment[] = [];
  const addSegment = (
    entry: AudioFileData | AudioCueEvent,
    text: string | undefined,
    source: TranscriptSegment["source"],
    messageId?: string,
  ) => {
    if (!text || !text.trim()) return;
    segments.push({
      userId: entry.userId,
      startedAt: new Date(entry.timestamp).toISOString(),
      text,
      source,
      messageId,
    });
  };

  for (const file of meeting.audioData.audioFiles) {
    addSegment(file, file.transcript, file.source ?? "voice", file.messageId);
  }
  for (const cue of meeting.audioData.cueEvents ?? []) {
    addSegment(cue, cue.text, cue.source ?? "bot");
  }

  segments.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return segments;
};

export function buildLiveMeetingTimelineEvents(
  meeting: MeetingData,
): MeetingEvent[] {
  const meetingStartMs = meeting.startTime.getTime();
  const events: EventWithSeconds[] = [];
  const transcriptSegments = buildTranscriptSegmentsFromMeeting(meeting);

  const spokenChatIds = new Set<string>();
  for (const segment of transcriptSegments) {
    if (!segment.text) continue;
    const startedAtMs = toSeconds(segment.startedAt, meetingStartMs);
    const elapsedSeconds = (startedAtMs - meetingStartMs) / 1000;
    const seconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    if (segment.source === "chat_tts") {
      if (segment.messageId) {
        spokenChatIds.add(segment.messageId);
      }
      addEvent(events, seconds, {
        id: buildEventId("tts", [
          segment.userId,
          segment.startedAt,
          segment.messageId,
        ]),
        type: "tts",
        time: formatElapsed(seconds),
        speaker: resolveLiveSpeaker(meeting, segment.userId),
        text: segment.text,
        messageId: segment.messageId,
      });
      continue;
    }
    if (segment.source === "bot") {
      addEvent(events, seconds, {
        id: buildEventId("bot", [segment.userId, segment.startedAt]),
        type: "bot",
        time: formatElapsed(seconds),
        text: segment.text,
      });
      continue;
    }
    addEvent(events, seconds, {
      id: buildEventId("voice", [segment.userId, segment.startedAt]),
      type: "voice",
      time: formatElapsed(seconds),
      speaker: resolveLiveSpeaker(meeting, segment.userId),
      text: segment.text,
    });
  }

  buildChatEvents(events, meeting.chatLog, meetingStartMs, spokenChatIds);

  if (meeting.notesChannelId) {
    buildNotesPostedEvent(
      events,
      meetingStartMs,
      meeting.notesLastEditedAt,
      meeting.endTime
        ? Math.floor((meeting.endTime.getTime() - meetingStartMs) / 1000)
        : 0,
      meeting.notesMessageIds?.[0],
    );
  }

  return sortEvents(events);
}
