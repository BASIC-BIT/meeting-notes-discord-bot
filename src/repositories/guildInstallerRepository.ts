import { getGuildInstaller, writeGuildInstaller } from "../db";
import { config } from "../services/configService";
import type { GuildInstaller } from "../types/db";
import { getMockStore } from "./mockStore";

export type GuildInstallerRepository = {
  get: (guildId: string) => Promise<GuildInstaller | undefined>;
  write: (installer: GuildInstaller) => Promise<void>;
};

const realRepository: GuildInstallerRepository = {
  get: getGuildInstaller,
  write: writeGuildInstaller,
};

const mockRepository: GuildInstallerRepository = {
  async get(guildId) {
    return getMockStore().guildInstallers.get(guildId);
  },
  async write(installer) {
    getMockStore().guildInstallers.set(installer.guildId, installer);
  },
};

export function getGuildInstallerRepository(): GuildInstallerRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
