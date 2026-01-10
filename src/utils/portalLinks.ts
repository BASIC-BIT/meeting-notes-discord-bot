export function buildPortalMeetingUrl(options: {
  baseUrl: string;
  guildId: string;
  meetingId: string;
  eventId?: string;
  fullScreen?: boolean;
}) {
  const { baseUrl, guildId, meetingId, eventId, fullScreen } = options;
  const params = new URLSearchParams({ meetingId });
  if (eventId) {
    params.set("eventId", eventId);
  }
  if (fullScreen) {
    params.set("fullScreen", "true");
  }
  const path = `/portal/server/${guildId}/library?${params.toString()}`;
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path}`;
}
