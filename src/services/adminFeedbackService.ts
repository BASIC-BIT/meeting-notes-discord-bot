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

type FeedbackListResult = {
  items: FeedbackRecord[];
  nextCursor?: string;
};

const resolveCursorEndAt = (cursor?: string) => {
  if (!cursor) return undefined;
  const parsed = Date.parse(cursor);
  if (Number.isNaN(parsed)) return cursor;
  return new Date(parsed - 1).toISOString();
};

const buildFeedbackKey = (item: FeedbackRecord) => `${item.pk}:${item.sk}`;

const dedupeFeedback = (items: FeedbackRecord[]) => {
  const map = new Map<string, FeedbackRecord>();
  items.forEach((item) => {
    map.set(buildFeedbackKey(item), item);
  });
  return Array.from(map.values());
};

export async function listFeedbackEntries(params: {
  targetType?: FeedbackTargetType;
  rating?: FeedbackRating;
  source?: FeedbackSource;
  limit?: number;
  cursor?: string;
}): Promise<FeedbackListResult> {
  const types = params.targetType ? [params.targetType] : ALL_TARGET_TYPES;
  const limit = params.limit ?? 100;
  const hasFilters = Boolean(params.rating || params.source);
  const perTypeLimit = Math.min(limit * (hasFilters ? 2 : 1), 500);
  const repo = getFeedbackRepository();
  const endAt = resolveCursorEndAt(params.cursor);
  const batches = await Promise.all(
    types.map((targetType) =>
      repo.listByTargetType({ targetType, limit: perTypeLimit, endAt }),
    ),
  );

  let items = dedupeFeedback(batches.flat());
  if (params.rating) {
    items = items.filter((item) => item.rating === params.rating);
  }
  if (params.source) {
    items = items.filter((item) => item.source === params.source);
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sliced = items.slice(0, limit);
  const nextCursor =
    sliced.length === limit ? sliced[sliced.length - 1]?.createdAt : undefined;
  return { items: sliced, nextCursor };
}
