import { config } from "../services/configService";
import { getGuildSubscription, writeGuildSubscription } from "../db";
import type { GuildSubscription } from "../types/db";
import { getMockStore } from "./mockStore";

export type SubscriptionRepository = {
  get: (guildId: string) => Promise<GuildSubscription | undefined>;
  write: (subscription: GuildSubscription) => Promise<void>;
};

const realRepository: SubscriptionRepository = {
  get: getGuildSubscription,
  write: writeGuildSubscription,
};

const mockRepository: SubscriptionRepository = {
  async get(guildId) {
    return getMockStore().subscriptions.get(guildId);
  },
  async write(subscription) {
    getMockStore().subscriptions.set(subscription.guildId, subscription);
  },
};

export function getSubscriptionRepository(): SubscriptionRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
