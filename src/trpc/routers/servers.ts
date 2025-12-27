import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ensureBotInGuild } from "../../services/guildAccessService";
import {
  isDiscordApiError,
  listBotGuilds,
  getGuildMember,
  listGuildChannels,
  listGuildRoles,
  listUserGuilds,
} from "../../services/discordService";
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordPermissionOverwrite,
  DiscordRole,
} from "../../repositories/types";
import { config } from "../../services/configService";
import { authedProcedure, manageGuildProcedure, router } from "../trpc";

type SessionGuildCache = {
  guildIds?: string[];
  guildIdsFetchedAt?: number;
  botGuildIds?: string[];
  botGuildIdsFetchedAt?: number;
};

const createRateLimitError = () =>
  new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Discord rate limited. Please retry.",
  });

const createBadGatewayError = (message: string) =>
  new TRPCError({
    code: "BAD_GATEWAY",
    message,
  });

const createBadRequestError = (message: string) =>
  new TRPCError({
    code: "BAD_REQUEST",
    message,
  });

const getSessionCache = (ctx: { req: { session: unknown } }) =>
  ctx.req.session as typeof ctx.req.session & SessionGuildCache;

const ensureBotPresence = async (
  serverId: string,
  sessionData: SessionGuildCache,
) => {
  const cacheAgeMs =
    sessionData.botGuildIdsFetchedAt != null
      ? Date.now() - sessionData.botGuildIdsFetchedAt
      : Number.POSITIVE_INFINITY;
  const cacheFresh = cacheAgeMs < 5 * 60 * 1000;
  if (cacheFresh && sessionData.botGuildIds) {
    if (!sessionData.botGuildIds.includes(serverId)) {
      throw createBadRequestError("Bot is not in that guild");
    }
    return;
  }

  const botCheck = await ensureBotInGuild(serverId);
  if (botCheck === null) {
    throw createRateLimitError();
  }
  if (!botCheck) {
    throw createBadRequestError("Bot is not in that guild");
  }

  sessionData.botGuildIds = Array.from(
    new Set([...(sessionData.botGuildIds ?? []), serverId]),
  );
  sessionData.botGuildIdsFetchedAt = Date.now();
};

const fetchGuildChannels = async (serverId: string) => {
  try {
    return await listGuildChannels(serverId);
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      throw createRateLimitError();
    }
    throw createBadGatewayError("Unable to fetch guild channels");
  }
};

const fetchPermissionSnapshot = async (serverId: string, botUserId: string) => {
  try {
    const roles = await listGuildRoles(serverId);
    const botMember = await getGuildMember(serverId, botUserId);
    return buildPermissionSnapshot(roles, botMember.roles ?? [], serverId);
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      throw createRateLimitError();
    }
    if (isDiscordApiError(err) && err.status === 403) {
      return null;
    }
    throw createBadGatewayError("Unable to fetch bot permissions");
  }
};

const listEligible = authedProcedure.query(async ({ ctx }) => {
  let userGuilds: DiscordGuild[];
  try {
    userGuilds = await listUserGuilds(ctx.user.accessToken ?? "");
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Discord rate limited. Please retry.",
      });
    }
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Unable to fetch guilds",
    });
  }

  const sessionData = ctx.req.session as typeof ctx.req.session & {
    guildIds?: string[];
    guildIdsFetchedAt?: number;
    botGuildIds?: string[];
    botGuildIdsFetchedAt?: number;
  };
  sessionData.guildIds = userGuilds.map((guild) => guild.id);
  sessionData.guildIdsFetchedAt = Date.now();

  let botGuilds: DiscordGuild[];
  try {
    botGuilds = await listBotGuilds();
  } catch (err) {
    if (isDiscordApiError(err) && err.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Discord rate limited. Please retry.",
      });
    }
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Unable to fetch bot guilds",
    });
  }
  const botGuildIds = new Set(botGuilds.map((g) => g.id));
  sessionData.botGuildIds = botGuilds.map((guild) => guild.id);
  sessionData.botGuildIdsFetchedAt = Date.now();

  const MANAGE_GUILD = 1 << 5;
  const ADMIN = 1 << 3;

  const eligible = userGuilds
    .filter((g) => botGuildIds.has(g.id))
    .filter((g) => {
      const perms = BigInt(g.permissions ?? "0");
      return (
        g.owner ||
        (perms & BigInt(MANAGE_GUILD)) !== BigInt(0) ||
        (perms & BigInt(ADMIN)) !== BigInt(0)
      );
    })
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon ?? undefined,
    }));

  return { guilds: eligible };
});

const channels = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    const { serverId } = input;
    const sessionData = getSessionCache(ctx);
    await ensureBotPresence(serverId, sessionData);

    const channels = await fetchGuildChannels(serverId);
    const botUserId = config.discord.clientId || "mock-bot";
    const permissionSnapshot = await fetchPermissionSnapshot(
      serverId,
      botUserId,
    );
    const voiceTypes = new Set([2, 13]);
    const textTypes = new Set([0, 5]);
    const byPosition = (a: { position?: number }, b: { position?: number }) =>
      (a.position ?? 0) - (b.position ?? 0);
    const voiceChannels = channels
      .filter((channel) => voiceTypes.has(channel.type))
      .sort(byPosition)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        ...(permissionSnapshot
          ? describeChannelAccess(
              channel,
              permissionSnapshot,
              serverId,
              botUserId,
              "voice",
            )
          : { botAccess: true, missingPermissions: [] as string[] }),
      }));
    const textChannels = channels
      .filter((channel) => textTypes.has(channel.type))
      .sort(byPosition)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        ...(permissionSnapshot
          ? describeChannelAccess(
              channel,
              permissionSnapshot,
              serverId,
              botUserId,
              "text",
            )
          : { botAccess: true, missingPermissions: [] as string[] }),
      }));

    return { voiceChannels, textChannels };
  });

export const serversRouter = router({
  listEligible,
  channels,
});

type PermissionSnapshot = {
  basePermissions: bigint;
  roleIds: Set<string>;
};

const ADMINISTRATOR = 1n << 3n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const CONNECT = 1n << 20n;

const permissionBits = {
  view: VIEW_CHANNEL,
  send: SEND_MESSAGES,
  connect: CONNECT,
};

const buildPermissionSnapshot = (
  roles: DiscordRole[],
  memberRoles: string[],
  guildId: string,
): PermissionSnapshot => {
  const rolePermissions = new Map<string, bigint>();
  roles.forEach((role) => {
    const raw = role.permissions || "0";
    rolePermissions.set(role.id, BigInt(raw));
  });
  const basePermissions = computeBasePermissions(
    rolePermissions,
    memberRoles,
    guildId,
  );
  return {
    basePermissions,
    roleIds: new Set(memberRoles),
  };
};

const computeBasePermissions = (
  rolePermissions: Map<string, bigint>,
  memberRoles: string[],
  guildId: string,
) => {
  const everyone = rolePermissions.get(guildId) ?? 0n;
  const combined = memberRoles.reduce(
    (total, roleId) => total | (rolePermissions.get(roleId) ?? 0n),
    everyone,
  );
  return combined;
};

const applyOverwrites = (
  base: bigint,
  overwrites: DiscordPermissionOverwrite[],
  guildId: string,
  memberId: string,
  roleIds: Set<string>,
) => {
  let permissions = base;
  const everyoneOverwrite = overwrites.find(
    (overwrite) => overwrite.id === guildId,
  );
  if (everyoneOverwrite) {
    permissions = applyAllowDeny(permissions, everyoneOverwrite);
  }

  const roleOverwrites = overwrites.filter((overwrite) =>
    roleIds.has(overwrite.id),
  );
  if (roleOverwrites.length > 0) {
    const combined = roleOverwrites.reduce(
      (acc, overwrite) => ({
        allow: acc.allow | BigInt(overwrite.allow ?? "0"),
        deny: acc.deny | BigInt(overwrite.deny ?? "0"),
      }),
      { allow: 0n, deny: 0n },
    );
    permissions = applyAllowDeny(permissions, {
      id: "roles",
      type: 0,
      allow: combined.allow.toString(),
      deny: combined.deny.toString(),
    });
  }

  const memberOverwrite = overwrites.find(
    (overwrite) => overwrite.id === memberId,
  );
  if (memberOverwrite) {
    permissions = applyAllowDeny(permissions, memberOverwrite);
  }

  return permissions;
};

const applyAllowDeny = (
  permissions: bigint,
  overwrite: DiscordPermissionOverwrite,
) => {
  const deny = BigInt(overwrite.deny ?? "0");
  const allow = BigInt(overwrite.allow ?? "0");
  let next = permissions;
  next &= ~deny;
  next |= allow;
  return next;
};

const describeChannelAccess = (
  channel: DiscordChannel,
  snapshot: PermissionSnapshot,
  guildId: string,
  memberId: string,
  kind: "voice" | "text",
) => {
  const overwrites = channel.permission_overwrites ?? [];
  let permissions = snapshot.basePermissions;
  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
    return { botAccess: true, missingPermissions: [] as string[] };
  }
  permissions = applyOverwrites(
    permissions,
    overwrites,
    guildId,
    memberId,
    snapshot.roleIds,
  );
  const required =
    kind === "voice"
      ? [
          { bit: permissionBits.view, label: "View Channel" },
          { bit: permissionBits.connect, label: "Connect" },
        ]
      : [
          { bit: permissionBits.view, label: "View Channel" },
          { bit: permissionBits.send, label: "Send Messages" },
        ];
  const missing = required
    .filter((perm) => (permissions & perm.bit) !== perm.bit)
    .map((perm) => perm.label);
  return { botAccess: missing.length === 0, missingPermissions: missing };
};
