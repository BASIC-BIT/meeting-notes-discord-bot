import { config } from "../services/configService";
import { getMockStore } from "./mockStore";
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "./types";

export class DiscordApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type DiscordRepository = {
  listUserGuilds: (accessToken: string) => Promise<DiscordGuild[]>;
  listBotGuilds: () => Promise<DiscordGuild[]>;
  listGuildChannels: (guildId: string) => Promise<DiscordChannel[]>;
  listGuildRoles: (guildId: string) => Promise<DiscordRole[]>;
  getGuildMember: (
    guildId: string,
    userId: string,
  ) => Promise<DiscordGuildMember>;
};

const realRepository: DiscordRepository = {
  async listUserGuilds(accessToken: string) {
    const resp = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      throw new DiscordApiError(resp.status, "Unable to fetch user guilds");
    }
    return (await resp.json()) as DiscordGuild[];
  },
  async listBotGuilds() {
    const resp = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${config.discord.botToken}` },
    });
    if (!resp.ok) {
      throw new DiscordApiError(resp.status, "Unable to fetch bot guilds");
    }
    return (await resp.json()) as DiscordGuild[];
  },
  async listGuildChannels(guildId: string) {
    const resp = await fetch(
      `https://discord.com/api/guilds/${guildId}/channels`,
      {
        headers: { Authorization: `Bot ${config.discord.botToken}` },
      },
    );
    if (!resp.ok) {
      throw new DiscordApiError(resp.status, "Unable to fetch guild channels");
    }
    return (await resp.json()) as DiscordChannel[];
  },
  async listGuildRoles(guildId: string) {
    const resp = await fetch(
      `https://discord.com/api/guilds/${guildId}/roles`,
      {
        headers: { Authorization: `Bot ${config.discord.botToken}` },
      },
    );
    if (!resp.ok) {
      throw new DiscordApiError(resp.status, "Unable to fetch guild roles");
    }
    return (await resp.json()) as DiscordRole[];
  },
  async getGuildMember(guildId: string, userId: string) {
    const resp = await fetch(
      `https://discord.com/api/guilds/${guildId}/members/${userId}`,
      {
        headers: { Authorization: `Bot ${config.discord.botToken}` },
      },
    );
    if (!resp.ok) {
      throw new DiscordApiError(resp.status, "Unable to fetch guild member");
    }
    return (await resp.json()) as DiscordGuildMember;
  },
};

const mockRepository: DiscordRepository = {
  async listUserGuilds() {
    return getMockStore().userGuilds;
  },
  async listBotGuilds() {
    return getMockStore().botGuilds;
  },
  async listGuildChannels(guildId: string) {
    return getMockStore().channelsByGuild.get(guildId) ?? [];
  },
  async listGuildRoles(guildId: string) {
    return getMockStore().rolesByGuild.get(guildId) ?? [];
  },
  async getGuildMember(guildId: string, userId: string) {
    const member =
      getMockStore().membersByGuild.get(`${guildId}#${userId}`) ?? null;
    if (!member) {
      throw new DiscordApiError(404, "Unable to fetch guild member");
    }
    return member;
  },
};

export function getDiscordRepository(): DiscordRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}

export function isDiscordApiError(error: unknown): error is DiscordApiError {
  return error instanceof DiscordApiError;
}
