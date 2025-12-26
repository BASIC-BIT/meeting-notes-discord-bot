import { config } from "../services/configService";
import {
  deleteAutoRecordSetting,
  getAllAutoRecordSettings,
  getAutoRecordSetting,
  writeAutoRecordSetting,
} from "../db";
import type { AutoRecordSettings } from "../types/db";
import { getMockStore } from "./mockStore";

export type AutoRecordRepository = {
  listByGuild: (guildId: string) => Promise<AutoRecordSettings[]>;
  getByGuildChannel: (
    guildId: string,
    channelId: string,
  ) => Promise<AutoRecordSettings | undefined>;
  write: (setting: AutoRecordSettings) => Promise<void>;
  remove: (guildId: string, channelId: string) => Promise<void>;
};

const realRepository: AutoRecordRepository = {
  listByGuild: getAllAutoRecordSettings,
  getByGuildChannel: getAutoRecordSetting,
  write: writeAutoRecordSetting,
  remove: deleteAutoRecordSetting,
};

const mockRepository: AutoRecordRepository = {
  async listByGuild(guildId) {
    return getMockStore().autoRecordByGuild.get(guildId) ?? [];
  },
  async getByGuildChannel(guildId, channelId) {
    const rules = getMockStore().autoRecordByGuild.get(guildId) ?? [];
    return rules.find((rule) => rule.channelId === channelId);
  },
  async write(setting) {
    const store = getMockStore();
    const rules = store.autoRecordByGuild.get(setting.guildId) ?? [];
    const filtered = rules.filter(
      (rule) => rule.channelId !== setting.channelId,
    );
    filtered.unshift(setting);
    store.autoRecordByGuild.set(setting.guildId, filtered);
  },
  async remove(guildId, channelId) {
    const store = getMockStore();
    const rules = store.autoRecordByGuild.get(guildId) ?? [];
    store.autoRecordByGuild.set(
      guildId,
      rules.filter((rule) => rule.channelId !== channelId),
    );
  },
};

export function getAutoRecordRepository(): AutoRecordRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
