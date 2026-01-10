import { getFeedback as getFeedbackRecord, writeFeedback } from "../db";
import { config } from "../services/configService";
import type { FeedbackRecord } from "../types/db";
import { getMockStore } from "./mockStore";

export type FeedbackRepository = {
  write: (record: FeedbackRecord) => Promise<void>;
  get: (pk: string, sk: string) => Promise<FeedbackRecord | undefined>;
};

const realRepository: FeedbackRepository = {
  write: writeFeedback,
  get: getFeedbackRecord,
};

const mockRepository: FeedbackRepository = {
  async write(record) {
    const store = getMockStore();
    const items = store.feedbackByTarget.get(record.pk) ?? [];
    const idx = items.findIndex((item) => item.sk === record.sk);
    if (idx >= 0) {
      items[idx] = record;
    } else {
      items.push(record);
    }
    store.feedbackByTarget.set(record.pk, items);
  },
  async get(pk, sk) {
    const items = getMockStore().feedbackByTarget.get(pk) ?? [];
    return items.find((item) => item.sk === sk);
  },
};

export function getFeedbackRepository(): FeedbackRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
