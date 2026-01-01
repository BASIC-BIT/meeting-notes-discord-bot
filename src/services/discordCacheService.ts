import { createHash } from "crypto";
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../repositories/types";
import {
  getGuildMember,
  isDiscordApiError,
  listBotGuilds,
  listGuildChannels,
  listGuildRoles,
  listUserGuilds,
} from "./discordService";
import { config } from "./configService";
import { buildCacheKey, cache, withCache } from "./cacheService";

type UserGuildsArgs = {
  accessToken: string;
  userId?: string;
};

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex").slice(0, 32);

const resolveUserKey = (args: UserGuildsArgs) =>
  args.userId ? `u:${args.userId}` : `t:${hashToken(args.accessToken)}`;

const refs = {
  guild: (guildId: string) => buildCacheKey(`discord:guild:${guildId}`),
  guildChannels: (guildId: string) =>
    buildCacheKey(`discord:guild:${guildId}:channels`),
  guildRoles: (guildId: string) =>
    buildCacheKey(`discord:guild:${guildId}:roles`),
  guildMember: (guildId: string, userId: string) =>
    buildCacheKey(`discord:guild:${guildId}:member:${userId}`),
  user: (userKey: string) => buildCacheKey(`discord:user:${userKey}`),
  botGuilds: () => buildCacheKey("discord:bot:guilds"),
};

const shouldFallbackDiscordCache = (error: unknown) =>
  !isDiscordApiError(error);

const cachedUserGuilds = cache.define(
  "discordUserGuilds",
  {
    ttl: config.cache.discord.userGuildsTtlSeconds,
    serialize: (args: UserGuildsArgs) =>
      buildCacheKey(`discord:userGuilds:${resolveUserKey(args)}`),
    references: (args) => [refs.user(resolveUserKey(args))],
  },
  async (args: UserGuildsArgs): Promise<DiscordGuild[]> =>
    listUserGuilds(args.accessToken),
).discordUserGuilds;

const cachedBotGuilds = cache.define(
  "discordBotGuilds",
  {
    ttl: config.cache.discord.botGuildsTtlSeconds,
    serialize: () => buildCacheKey("discord:botGuilds"),
    references: () => [refs.botGuilds()],
  },
  async (): Promise<DiscordGuild[]> => listBotGuilds(),
).discordBotGuilds;

const cachedGuildChannels = cache.define(
  "discordGuildChannels",
  {
    ttl: config.cache.discord.channelsTtlSeconds,
    serialize: ({ guildId }: { guildId: string }) =>
      buildCacheKey(`discord:guildChannels:${guildId}`),
    references: ({ guildId }) => [
      refs.guild(guildId),
      refs.guildChannels(guildId),
    ],
  },
  async ({ guildId }: { guildId: string }): Promise<DiscordChannel[]> =>
    listGuildChannels(guildId),
).discordGuildChannels;

const cachedGuildRoles = cache.define(
  "discordGuildRoles",
  {
    ttl: config.cache.discord.rolesTtlSeconds,
    serialize: ({ guildId }: { guildId: string }) =>
      buildCacheKey(`discord:guildRoles:${guildId}`),
    references: ({ guildId }) => [
      refs.guild(guildId),
      refs.guildRoles(guildId),
    ],
  },
  async ({ guildId }: { guildId: string }): Promise<DiscordRole[]> =>
    listGuildRoles(guildId),
).discordGuildRoles;

const cachedGuildMember = cache.define(
  "discordGuildMember",
  {
    ttl: config.cache.discord.membersTtlSeconds,
    serialize: ({ guildId, userId }: { guildId: string; userId: string }) =>
      buildCacheKey(`discord:guildMember:${guildId}:${userId}`),
    references: ({ guildId, userId }) => [
      refs.guild(guildId),
      refs.guildMember(guildId, userId),
    ],
  },
  async ({
    guildId,
    userId,
  }: {
    guildId: string;
    userId: string;
  }): Promise<DiscordGuildMember> => getGuildMember(guildId, userId),
).discordGuildMember;

export const listUserGuildsCached = async (
  args: UserGuildsArgs,
): Promise<DiscordGuild[]> =>
  withCache(
    "listUserGuilds",
    () => cachedUserGuilds(args),
    () => listUserGuilds(args.accessToken),
    shouldFallbackDiscordCache,
  );

export const listBotGuildsCached = async (): Promise<DiscordGuild[]> =>
  withCache(
    "listBotGuilds",
    () => cachedBotGuilds(),
    () => listBotGuilds(),
    shouldFallbackDiscordCache,
  );

export const listGuildChannelsCached = async (
  guildId: string,
): Promise<DiscordChannel[]> =>
  withCache(
    "listGuildChannels",
    () => cachedGuildChannels({ guildId }),
    () => listGuildChannels(guildId),
    shouldFallbackDiscordCache,
  );

export const listGuildRolesCached = async (
  guildId: string,
): Promise<DiscordRole[]> =>
  withCache(
    "listGuildRoles",
    () => cachedGuildRoles({ guildId }),
    () => listGuildRoles(guildId),
    shouldFallbackDiscordCache,
  );

export const getGuildMemberCached = async (
  guildId: string,
  userId: string,
): Promise<DiscordGuildMember> =>
  withCache(
    "getGuildMember",
    () => cachedGuildMember({ guildId, userId }),
    () => getGuildMember(guildId, userId),
    shouldFallbackDiscordCache,
  );

export const invalidateDiscordGuildCache = async (guildId: string) =>
  cache.invalidateAll(refs.guild(guildId));

export const invalidateDiscordUserCache = async (userId: string) =>
  cache.invalidateAll(refs.user(`u:${userId}`));

export const invalidateDiscordBotGuildsCache = async () =>
  cache.invalidateAll(refs.botGuilds());
