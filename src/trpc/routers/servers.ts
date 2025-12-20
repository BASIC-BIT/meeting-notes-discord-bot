import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ensureBotInGuild,
  ensureUserInGuild,
} from "../../services/guildAccessService";
import { config } from "../../services/configService";
import { authedProcedure, router } from "../trpc";

const listEligible = authedProcedure.query(async ({ ctx }) => {
  const userGuildsResp = await fetch(
    "https://discord.com/api/users/@me/guilds",
    {
      headers: { Authorization: `Bearer ${ctx.user.accessToken}` },
    },
  );
  if (userGuildsResp.status === 429) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Discord rate limited. Please retry.",
    });
  }
  if (!userGuildsResp.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Unable to fetch guilds",
    });
  }
  const userGuilds = (await userGuildsResp.json()) as Array<{
    id: string;
    name: string;
    icon?: string;
    permissions: string;
    owner?: boolean;
  }>;

  const sessionData = ctx.req.session as typeof ctx.req.session & {
    guildIds?: string[];
    guildIdsFetchedAt?: number;
    botGuildIds?: string[];
    botGuildIdsFetchedAt?: number;
  };
  sessionData.guildIds = userGuilds.map((guild) => guild.id);
  sessionData.guildIdsFetchedAt = Date.now();

  const botGuildsResp = await fetch(
    "https://discord.com/api/users/@me/guilds",
    {
      headers: { Authorization: `Bot ${config.discord.botToken}` },
    },
  );
  if (botGuildsResp.status === 429) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Discord rate limited. Please retry.",
    });
  }
  if (!botGuildsResp.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Unable to fetch bot guilds",
    });
  }
  const botGuilds = (await botGuildsResp.json()) as Array<{ id: string }>;
  const botGuildIds = new Set(botGuilds.map((g) => g.id));
  sessionData.botGuildIds = botGuilds.map((guild) => guild.id);
  sessionData.botGuildIdsFetchedAt = Date.now();

  const MANAGE_GUILD = 1 << 5;
  const ADMIN = 1 << 3;

  const eligible = userGuilds
    .filter((g) => botGuildIds.has(g.id))
    .filter((g) => {
      const perms = BigInt(g.permissions);
      return (
        g.owner ||
        (perms & BigInt(MANAGE_GUILD)) !== BigInt(0) ||
        (perms & BigInt(ADMIN)) !== BigInt(0)
      );
    })
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
    }));

  return { guilds: eligible };
});

const channels = authedProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    const { serverId } = input;
    const sessionData = ctx.req.session as typeof ctx.req.session & {
      guildIds?: string[];
      guildIdsFetchedAt?: number;
      botGuildIds?: string[];
      botGuildIdsFetchedAt?: number;
    };

    const cachedGuilds = sessionData.guildIds ?? [];
    if (!cachedGuilds.includes(serverId)) {
      const accessCheck = await ensureUserInGuild(
        ctx.user.accessToken,
        serverId,
      );
      if (accessCheck === null) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Discord rate limited. Please retry.",
        });
      }
      if (!accessCheck) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Guild access required",
        });
      }
    }

    const cacheAgeMs =
      sessionData.botGuildIdsFetchedAt != null
        ? Date.now() - sessionData.botGuildIdsFetchedAt
        : Number.POSITIVE_INFINITY;
    const cacheFresh = cacheAgeMs < 5 * 60 * 1000;
    if (cacheFresh && sessionData.botGuildIds) {
      if (!sessionData.botGuildIds.includes(serverId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bot is not in that guild",
        });
      }
    } else {
      const botCheck = await ensureBotInGuild(serverId);
      if (botCheck === null) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Discord rate limited. Please retry.",
        });
      }
      if (!botCheck) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bot is not in that guild",
        });
      }
      sessionData.botGuildIds = Array.from(
        new Set([...(sessionData.botGuildIds ?? []), serverId]),
      );
      sessionData.botGuildIdsFetchedAt = Date.now();
    }

    const resp = await fetch(
      `https://discord.com/api/guilds/${serverId}/channels`,
      {
        headers: { Authorization: `Bot ${config.discord.botToken}` },
      },
    );
    if (!resp.ok) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Unable to fetch guild channels",
      });
    }
    const channels = (await resp.json()) as Array<{
      id: string;
      name: string;
      type: number;
      position?: number;
    }>;
    const voiceTypes = new Set([2, 13]);
    const textTypes = new Set([0, 5]);
    const byPosition = (a: { position?: number }, b: { position?: number }) =>
      (a.position ?? 0) - (b.position ?? 0);
    const voiceChannels = channels
      .filter((channel) => voiceTypes.has(channel.type))
      .sort(byPosition)
      .map((channel) => ({ id: channel.id, name: channel.name }));
    const textChannels = channels
      .filter((channel) => textTypes.has(channel.type))
      .sort(byPosition)
      .map((channel) => ({ id: channel.id, name: channel.name }));

    return { voiceChannels, textChannels };
  });

export const serversRouter = router({
  listEligible,
  channels,
});
