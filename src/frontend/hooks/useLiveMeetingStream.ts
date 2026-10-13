import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "../services/apiClient";
import type {
  LiveMeetingAttendeesPayload,
  LiveMeetingEventsPayload,
  LiveMeetingInitPayload,
  LiveMeetingMeta,
  LiveMeetingStatus,
  LiveMeetingStatusPayload,
} from "../../types/liveMeeting";
import type { MeetingEvent } from "../../types/meetingTimeline";
import { MEETING_STATUS } from "../../types/meetingLifecycle";

export type LiveStreamStatus =
  "connecting" | "live" | "processing" | "complete" | "cancelled" | "error";

const toStreamStatus = (status: LiveMeetingStatus): LiveStreamStatus => {
  if (status === MEETING_STATUS.COMPLETE) return "complete";
  if (status === MEETING_STATUS.PROCESSING) return "processing";
  if (status === MEETING_STATUS.CANCELLED) return "cancelled";
  return "live";
};

type UseLiveMeetingStreamOptions = {
  guildId: string;
  meetingId: string;
  enabled: boolean;
};

export function useLiveMeetingStream({
  guildId,
  meetingId,
  enabled,
}: UseLiveMeetingStreamOptions) {
  const [meeting, setMeeting] = useState<LiveMeetingMeta | null>(null);
  const [events, setEvents] = useState<MeetingEvent[]>([]);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [status, setStatus] = useState<LiveStreamStatus>("connecting");
  const [retryKey, setRetryKey] = useState(0);
  const identityRef = useRef("");

  const retry = useCallback(() => {
    setRetryKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!guildId || !meetingId) return;

    const identity = `${guildId}:${meetingId}`;
    if (identityRef.current !== identity) {
      setMeeting(null);
      setEvents([]);
      setAttendees([]);
      identityRef.current = identity;
    }
    setStatus("connecting");

    const url = buildApiUrl(`/api/live/${guildId}/${meetingId}/stream`);
    const source = new EventSource(url, { withCredentials: true });

    source.addEventListener("init", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingInitPayload;
      setMeeting(payload.meeting);
      setEvents(payload.events);
      setAttendees(payload.meeting.attendees ?? []);
      setStatus(toStreamStatus(payload.meeting.status));
    });

    source.addEventListener("events", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingEventsPayload;
      setEvents((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        for (const id of payload.removedEventIds ?? []) byId.delete(id);
        for (const entry of payload.events) byId.set(entry.id, entry);
        return [...byId.values()].sort((left, right) =>
          left.offsetSeconds !== undefined && right.offsetSeconds !== undefined
            ? left.offsetSeconds - right.offsetSeconds
            : 0,
        );
      });
    });

    source.addEventListener("attendees", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingAttendeesPayload;
      setAttendees(payload.attendees);
    });

    source.addEventListener("status", (event) => {
      const payload = JSON.parse(event.data) as LiveMeetingStatusPayload;
      setMeeting((current) =>
        current ? { ...current, status: payload.status } : current,
      );
      setStatus(toStreamStatus(payload.status));
    });

    source.onerror = () => {
      setStatus((current) =>
        current === MEETING_STATUS.COMPLETE ||
        current === MEETING_STATUS.CANCELLED
          ? current
          : "error",
      );
      source.close();
    };

    return () => {
      source.close();
    };
  }, [enabled, guildId, meetingId, retryKey]);

  return {
    meeting,
    events,
    attendees,
    status,
    retry,
  };
}
