import type { AuthedProfile } from "../trpc/context";
import { config } from "./configService";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_DEFAULT_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const DISCORD_REFRESH_GRACE_MS = 60 * 1000;

type DiscordTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export function buildDiscordAuthProfile(
  profile: AuthedProfile,
  accessToken: string,
  refreshToken: string,
): AuthedProfile {
  return {
    ...profile,
    accessToken,
    refreshToken,
    tokenExpiresAt: Date.now() + DISCORD_DEFAULT_EXPIRES_MS,
  };
}

export function isDiscordTokenFresh(user: AuthedProfile, nowMs = Date.now()) {
  const expiresAt = user.tokenExpiresAt ?? 0;
  return expiresAt - DISCORD_REFRESH_GRACE_MS > nowMs;
}

export async function refreshDiscordAccessToken(
  refreshToken: string,
): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: config.discord.callbackUrl,
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Discord token refresh failed: ${response.status}`);
  }

  return (await response.json()) as DiscordTokenResponse;
}

export async function ensureDiscordAccessToken(
  user: AuthedProfile,
): Promise<AuthedProfile> {
  if (!user.refreshToken) return user;
  if (isDiscordTokenFresh(user)) return user;

  try {
    const refreshed = await refreshDiscordAccessToken(user.refreshToken);
    return {
      ...user,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? user.refreshToken,
      tokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
    };
  } catch (err) {
    console.error("Failed to refresh Discord token", err);
    return user;
  }
}
