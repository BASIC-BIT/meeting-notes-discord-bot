import type { LiveMeetingStatusResponse } from "../../types/liveMeeting";
import { apiFetch } from "./apiClient";

export function fetchLiveMeetingStatus(
  guildId: string,
  meetingId: string,
): Promise<LiveMeetingStatusResponse> {
  return apiFetch(`/api/live/${guildId}/${meetingId}/status`);
}

export function endLiveMeeting(
  guildId: string,
  meetingId: string,
): Promise<{ status: string }> {
  return apiFetch(`/api/live/${guildId}/${meetingId}/end`, {
    method: "POST",
  });
}
