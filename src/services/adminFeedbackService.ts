import { getFeedbackRepository } from "../repositories/feedbackRepository";
import type {
  FeedbackRating,
  FeedbackRecord,
  FeedbackSource,
  FeedbackTargetType,
} from "../types/db";

const ALL_TARGET_TYPES: FeedbackTargetType[] = [
  "meeting_summary",
  "ask_answer",
];

export async function listFeedbackEntries(params: {
  targetType?: FeedbackTargetType;
  rating?: FeedbackRating;
  source?: FeedbackSource;
  limit?: number;
}): Promise<FeedbackRecord[]> {
  const types = params.targetType ? [params.targetType] : ALL_TARGET_TYPES;
  const limit = params.limit ?? 100;
  const repo = getFeedbackRepository();

  const batches = await Promise.all(
    types.map((targetType) => repo.listByTargetType({ targetType, limit })),
  );

  let items = batches.flat();
  if (params.rating) {
    items = items.filter((item) => item.rating === params.rating);
  }
  if (params.source) {
    items = items.filter((item) => item.source === params.source);
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, limit);
}
