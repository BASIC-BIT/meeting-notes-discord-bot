import type { FeedbackRecord } from "../types/db";

export const MAX_FEEDBACK_COMMENT_LENGTH = 1000;

export const buildFeedbackPk = (
  targetType: FeedbackRecord["targetType"],
  targetId: string,
) => `TARGET#${targetType}#${targetId}`;

export const buildFeedbackSk = (userId: string) => `USER#${userId}`;

export const normalizeFeedbackComment = (
  comment?: string,
): string | undefined => {
  const trimmed = comment?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_FEEDBACK_COMMENT_LENGTH);
};
