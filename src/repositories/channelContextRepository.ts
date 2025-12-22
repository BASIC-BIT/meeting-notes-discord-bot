import { config } from "../services/configService";
import {
  deleteChannelContext,
  getAllChannelContexts,
  getChannelContext,
  writeChannelContext,
} from "../db";
import type { ChannelContext } from "../types/db";
import { getMockStore } from "./mockStore";

export type ChannelContextRepository = {
  get: (
    guildId: string,
    channelId: string,
  ) => Promise<ChannelContext | undefined>;
  listByGuild: (guildId: string) => Promise<ChannelContext[]>;
  write: (context: ChannelContext) => Promise<void>;
  remove: (guildId: string, channelId: string) => Promise<void>;
};

const realRepository: ChannelContextRepository = {
  get: getChannelContext,
  listByGuild: getAllChannelContexts,
  write: writeChannelContext,
  remove: deleteChannelContext,
};

const buildKey = (guildId: string, channelId: string) =>
  `${guildId}#${channelId}`;

const mockRepository: ChannelContextRepository = {
  async get(guildId, channelId) {
    return getMockStore().channelContexts.get(buildKey(guildId, channelId));
  },
  async listByGuild(guildId) {
    return Array.from(getMockStore().channelContexts.values()).filter(
      (ctx) => ctx.guildId === guildId,
    );
  },
  async write(context) {
    getMockStore().channelContexts.set(
      buildKey(context.guildId, context.channelId),
      context,
    );
  },
  async remove(guildId, channelId) {
    getMockStore().channelContexts.delete(buildKey(guildId, channelId));
  },
};

export function getChannelContextRepository(): ChannelContextRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
