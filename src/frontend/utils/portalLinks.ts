export type PortalMeetingLink = {
  serverId: string;
  meetingId: string;
  eventId?: string;
  fullScreen?: boolean;
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
  const fullScreenParam = url.searchParams.get("fullScreen");
  const fullScreen =
    fullScreenParam === "true" || fullScreenParam === "1" ? true : undefined;
  return { serverId, meetingId, eventId, fullScreen };
};

export const buildMeetingLinkForLocation = (options: {
  pathname: string;
  search: string;
  meetingId: string;
  eventId?: string;
  fullScreen?: boolean;
}) => {
  const params = new URLSearchParams(options.search);
  params.set("meetingId", options.meetingId);
  if (options.eventId) {
    params.set("eventId", options.eventId);
  } else {
    params.delete("eventId");
  }
  if (options.fullScreen) {
    params.set("fullScreen", "true");
  } else {
    params.delete("fullScreen");
  }
  const query = params.toString();
  return `${options.pathname}${query ? `?${query}` : ""}`;
};
