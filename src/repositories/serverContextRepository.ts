import { config } from "../services/configService";
import {
  deleteServerContext,
  getServerContext,
  writeServerContext,
} from "../db";
import type { ServerContext } from "../types/db";
import { getMockStore } from "./mockStore";

export type ServerContextRepository = {
  get: (guildId: string) => Promise<ServerContext | undefined>;
  write: (context: ServerContext) => Promise<void>;
  remove: (guildId: string) => Promise<void>;
};

const realRepository: ServerContextRepository = {
  get: getServerContext,
  write: writeServerContext,
  remove: deleteServerContext,
};

const mockRepository: ServerContextRepository = {
  async get(guildId) {
    return getMockStore().serverContexts.get(guildId);
  },
  async write(context) {
    getMockStore().serverContexts.set(context.guildId, context);
  },
  async remove(guildId) {
    getMockStore().serverContexts.delete(guildId);
  },
};

export function getServerContextRepository(): ServerContextRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
