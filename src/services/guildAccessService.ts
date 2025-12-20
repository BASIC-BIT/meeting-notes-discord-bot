import { config } from "./configService";

const MANAGE_GUILD = 1 << 5;
const ADMIN = 1 << 3;

export async function ensureManageGuildWithUserToken(
  userAccessToken: string | undefined,
  guildId: string,
): Promise<boolean> {
  if (!userAccessToken) return false;
  try {
    const resp = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!resp.ok) return false;
    const guilds = (await resp.json()) as Array<{
      id: string;
      permissions: string;
      owner?: boolean;
    }>;
    const target = guilds.find((g) => g.id === guildId);
    if (!target) return false;
    if (target.owner) return true;
    const perms = BigInt(target.permissions ?? "0");
    return (
      (perms & BigInt(MANAGE_GUILD)) !== BigInt(0) ||
      (perms & BigInt(ADMIN)) !== BigInt(0)
    );
  } catch (err) {
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
    const resp = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (resp.status === 429) {
      console.warn("ensureUserInGuild rate limited", { guildId });
      return null;
    }
    if (!resp.ok) {
      console.warn("ensureUserInGuild failed", {
        guildId,
        status: resp.status,
      });
      return false;
    }
    const guilds = (await resp.json()) as Array<{ id: string }>;
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
    console.error("ensureUserInGuild error", err);
    return false;
  }
}

export async function ensureBotInGuild(
  guildId: string,
): Promise<boolean | null> {
  try {
    const resp = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${config.discord.botToken}` },
    });
    if (resp.status === 429) {
      console.warn("ensureBotInGuild rate limited", { guildId });
      return null;
    }
    if (!resp.ok) return false;
    const guilds = (await resp.json()) as Array<{ id: string }>;
    return guilds.some((g) => g.id === guildId);
  } catch (err) {
    console.error("ensureBotInGuild error", err);
    return false;
  }
}
