import { config } from "../services/configService";
import {
  deleteDictionaryEntry,
  getDictionaryEntry,
  listDictionaryEntries,
  writeDictionaryEntry,
} from "../db";
import type { DictionaryEntry } from "../types/db";
import { getMockStore } from "./mockStore";

export type DictionaryRepository = {
  listByGuild: (guildId: string) => Promise<DictionaryEntry[]>;
  get: (
    guildId: string,
    termKey: string,
  ) => Promise<DictionaryEntry | undefined>;
  write: (entry: DictionaryEntry) => Promise<void>;
  remove: (guildId: string, termKey: string) => Promise<void>;
};

const realRepository: DictionaryRepository = {
  listByGuild: listDictionaryEntries,
  get: getDictionaryEntry,
  write: writeDictionaryEntry,
  remove: deleteDictionaryEntry,
};

const mockRepository: DictionaryRepository = {
  async listByGuild(guildId) {
    return getMockStore().dictionaryEntriesByGuild.get(guildId) ?? [];
  },
  async get(guildId, termKey) {
    const entries = getMockStore().dictionaryEntriesByGuild.get(guildId) ?? [];
    return entries.find((entry) => entry.termKey === termKey);
  },
  async write(entry) {
    const store = getMockStore();
    const entries = store.dictionaryEntriesByGuild.get(entry.guildId) ?? [];
    const index = entries.findIndex((item) => item.termKey === entry.termKey);
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
    store.dictionaryEntriesByGuild.set(entry.guildId, entries);
  },
  async remove(guildId, termKey) {
    const store = getMockStore();
    const entries = store.dictionaryEntriesByGuild.get(guildId) ?? [];
    store.dictionaryEntriesByGuild.set(
      guildId,
      entries.filter((entry) => entry.termKey !== termKey),
    );
  },
};

export function getDictionaryRepository(): DictionaryRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
