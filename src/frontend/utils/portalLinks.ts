export type PortalMeetingLink = {
  serverId: string;
  meetingId: string;
  eventId?: string;
};

const portalServerPath = /^\/portal\/server\/([^/]+)\//;

export const parsePortalMeetingLink = (
  href: string,
  origin: string,
): PortalMeetingLink | null => {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  const meetingId = url.searchParams.get("meetingId");
  if (!meetingId) return null;
  const match = url.pathname.match(portalServerPath);
  if (!match) return null;
  const serverId = match[1];
  const eventId = url.searchParams.get("eventId") ?? undefined;
  return { serverId, meetingId, eventId };
};

export const buildMeetingLinkForLocation = (options: {
  pathname: string;
  search: string;
  meetingId: string;
  eventId?: string;
}) => {
  const params = new URLSearchParams(options.search);
  params.set("meetingId", options.meetingId);
  if (options.eventId) {
    params.set("eventId", options.eventId);
  } else {
    params.delete("eventId");
  }
  const query = params.toString();
  return `${options.pathname}${query ? `?${query}` : ""}`;
};
