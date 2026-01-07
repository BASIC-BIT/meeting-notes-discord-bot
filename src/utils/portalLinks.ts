export function buildPortalMeetingUrl(options: {
  baseUrl: string;
  guildId: string;
  meetingId: string;
  eventId?: string;
}) {
  const { baseUrl, guildId, meetingId, eventId } = options;
  const path = `/portal/server/${guildId}/library?meetingId=${encodeURIComponent(
    meetingId,
  )}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ""}`;
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path}`;
}
