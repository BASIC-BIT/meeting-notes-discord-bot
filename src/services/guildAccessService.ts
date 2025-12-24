import {
  isDiscordApiError,
  listBotGuilds,
  listUserGuilds,
} from "./discordService";

const MANAGE_GUILD = 1 << 5;
const ADMIN = 1 << 3;

export async function ensureManageGuildWithUserToken(
  userAccessToken: string | undefined,
  guildId: string,
): Promise<boolean | null> {
  if (!userAccessToken) return false;
  try {
    const guilds = await listUserGuilds(userAccessToken);
    const target = guilds.find((g) => g.id === guildId);
    if (!target) return false;
    if (target.owner) return true;
    const perms = BigInt(target.permissions ?? "0");
    return (
      (perms & BigInt(MANAGE_GUILD)) !== BigInt(0) ||
      (perms & BigInt(ADMIN)) !== BigInt(0)
    );
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      console.warn("ensureManageGuildWithUserToken rate limited", { guildId });
      return null;
    }
    console.error("ensureManageGuildWithUserToken error", err);
    return false;
  }
}

export async function ensureUserInGuild(
  userAccessToken: string | undefined,
  guildId: string,
): Promise<boolean | null> {
  if (!userAccessToken) return false;
  try {
    const guilds = await listUserGuilds(userAccessToken);
    const ok = guilds.some((g) => g.id === guildId);
    if (!ok) {
      console.warn("ensureUserInGuild missing guild", {
        guildId,
        guildCount: guilds.length,
        sample: guilds.slice(0, 5).map((g) => g.id),
      });
    }
    return ok;
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      console.warn("ensureUserInGuild rate limited", { guildId });
      return null;
    }
    console.error("ensureUserInGuild error", err);
    return false;
  }
}

export async function ensureBotInGuild(
  guildId: string,
): Promise<boolean | null> {
  try {
    const guilds = await listBotGuilds();
    return guilds.some((g) => g.id === guildId);
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      console.warn("ensureBotInGuild rate limited", { guildId });
      return null;
    }
    console.error("ensureBotInGuild error", err);
    return false;
  }
}
