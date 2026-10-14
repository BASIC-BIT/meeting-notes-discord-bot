import { config } from "../services/configService";
import { getMockStore } from "./mockStore";
import { readOfferUsage, compareAndWriteOfferUsage } from "../db";
import {
  offerUsageKey,
  parseOfferUsageChange,
  type IntroOfferId,
  type ProviderMode,
  type OfferUsage,
  type OfferUsageWrite,
} from "../types/offerUsage";

export const getOfferUsageRepository = () => ({
  async get(
    guildId: string,
    offerId: IntroOfferId,
    mode: ProviderMode,
  ): Promise<OfferUsage | undefined> {
    const key = offerUsageKey(guildId, offerId, mode);
    return config.mock.enabled
      ? structuredClone(getMockStore().offerUsages.get(key))
      : readOfferUsage(guildId, offerId, mode);
  },
  async compareAndWrite(input: OfferUsageWrite): Promise<boolean> {
    const { next, expected } = parseOfferUsageChange(input);
    if (!config.mock.enabled) return compareAndWriteOfferUsage(input);
    const store = getMockStore();
    const key = offerUsageKey(next.guildId, next.offerId, next.mode);
    const current = store.offerUsages.get(key);
    const operation = store.purchaseAttempts.get(next.guildId);
    const pointer = store.subscriptions.get(next.guildId);
    if (
      current?.revision !== expected?.revision ||
      operation?.revision !== input.operation.revision ||
      operation?.attemptId !== input.operation.attemptId ||
      operation?.mode !== next.mode ||
      Boolean(pointer) !== Boolean(input.pointer) ||
      pointer?.stripeSubscriptionId !== input.pointer?.stripeSubscriptionId ||
      pointer?.stripeSyncRevision !== input.pointer?.stripeSyncRevision
    )
      return false;
    store.offerUsages.set(key, structuredClone(next));
    return true;
  },
});
