export type DeviceKind = "mobile" | "desktop" | "unknown";

type DeviceResolutionOptions = {
  userAgent?: string;
  userAgentDataMobile?: boolean;
  forceDevice?: DeviceKind;
};

const discordChannelHosts = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
  "www.discord.com",
  "www.discordapp.com",
]);

export const isMobileUserAgent = (userAgent: string) =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i.test(
    userAgent,
  );

export const resolveDeviceKind = (
  options: DeviceResolutionOptions = {},
): DeviceKind => {
  if (options.forceDevice) return options.forceDevice;
  const uaMobile =
    options.userAgentDataMobile ??
    (typeof navigator !== "undefined"
      ? navigator.userAgentData?.mobile
      : undefined);
  if (uaMobile === true) return "mobile";
  const ua =
    options.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!ua && uaMobile === undefined) return "unknown";
  return isMobileUserAgent(ua) ? "mobile" : "desktop";
};

const parseDiscordChannelUrl = (href: string) => {
  if (!href) return null;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol === "discord:") {
    return parsed;
  }
  if (!discordChannelHosts.has(parsed.hostname)) return null;
  if (!parsed.pathname.startsWith("/channels/")) return null;
  return parsed;
};

const toDiscordDesktopUrl = (url: URL) =>
  `discord://${url.hostname}${url.pathname}${url.search}${url.hash}`;

export const getDiscordOpenUrl = (
  href: string,
  options: DeviceResolutionOptions = {},
) => {
  const parsed = parseDiscordChannelUrl(href);
  if (!parsed) return href;
  if (parsed.protocol === "discord:") return href;
  const device = resolveDeviceKind(options);
  if (device !== "desktop") return href;
  return toDiscordDesktopUrl(parsed);
};
