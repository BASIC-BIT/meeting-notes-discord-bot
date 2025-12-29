import { config } from "../services/configService";
import {
  deleteUserSpeechSettings,
  getUserSpeechSettings,
  writeUserSpeechSettings,
} from "../db";
import type { UserSpeechSettings } from "../types/db";
import { getMockStore } from "./mockStore";

export type UserSpeechSettingsRepository = {
  get: (
    guildId: string,
    userId: string,
  ) => Promise<UserSpeechSettings | undefined>;
  write: (settings: UserSpeechSettings) => Promise<void>;
  remove: (guildId: string, userId: string) => Promise<void>;
};

const realRepository: UserSpeechSettingsRepository = {
  get: getUserSpeechSettings,
  write: writeUserSpeechSettings,
  remove: deleteUserSpeechSettings,
};

const mockRepository: UserSpeechSettingsRepository = {
  async get(guildId, userId) {
    return getMockStore().userSpeechSettings.get(`${guildId}#${userId}`);
  },
  async write(settings) {
    getMockStore().userSpeechSettings.set(
      `${settings.guildId}#${settings.userId}`,
      settings,
    );
  },
  async remove(guildId, userId) {
    getMockStore().userSpeechSettings.delete(`${guildId}#${userId}`);
  },
};

export function getUserSpeechSettingsRepository(): UserSpeechSettingsRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
