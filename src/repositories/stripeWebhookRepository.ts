import { config } from "../services/configService";
import { getStripeWebhookEvent, writeStripeWebhookEvent } from "../db";
import type { StripeWebhookEvent } from "../types/db";
import { getMockStore } from "./mockStore";

export type StripeWebhookRepository = {
  get: (eventId: string) => Promise<StripeWebhookEvent | undefined>;
  write: (event: StripeWebhookEvent) => Promise<void>;
};

const realRepository: StripeWebhookRepository = {
  get: getStripeWebhookEvent,
  write: writeStripeWebhookEvent,
};

const mockRepository: StripeWebhookRepository = {
  async get(eventId) {
    return getMockStore().stripeWebhookEvents.get(eventId);
  },
  async write(event) {
    getMockStore().stripeWebhookEvents.set(event.eventId, event);
  },
};

export function getStripeWebhookRepository(): StripeWebhookRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
