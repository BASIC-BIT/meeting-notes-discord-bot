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
    }>;
    const target = guilds.find((g) => g.id === guildId);
    if (!target) return false;
    const perms = BigInt(target.permissions);
    return (
      (perms & BigInt(MANAGE_GUILD)) !== BigInt(0) ||
      (perms & BigInt(ADMIN)) !== BigInt(0)
    );
  } catch (err) {
    console.error("ensureManageGuildWithUserToken error", err);
    return false;
  }
}

export async function ensureBotInGuild(guildId: string): Promise<boolean> {
  try {
    const resp = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${config.discord.botToken}` },
    });
    if (!resp.ok) return false;
    const guilds = (await resp.json()) as Array<{ id: string }>;
    return guilds.some((g) => g.id === guildId);
  } catch (err) {
    console.error("ensureBotInGuild error", err);
    return false;
  }
}
