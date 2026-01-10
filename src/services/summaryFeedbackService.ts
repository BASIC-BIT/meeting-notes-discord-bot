import { getFeedbackRepository } from "../repositories/feedbackRepository";
import type {
  FeedbackRating,
  FeedbackRecord,
  FeedbackSource,
} from "../types/db";
import { nowIso } from "../utils/time";
import { getMeetingHistoryService } from "./meetingHistoryService";

const MAX_FEEDBACK_COMMENT_LENGTH = 1000;

const buildFeedbackPk = (
  targetType: FeedbackRecord["targetType"],
  targetId: string,
) => `TARGET#${targetType}#${targetId}`;
const buildFeedbackSk = (userId: string) => `USER#${userId}`;

export const buildMeetingSummaryFeedbackKeys = (params: {
  channelIdTimestamp: string;
  userId: string;
}) => ({
  pk: buildFeedbackPk("meeting_summary", params.channelIdTimestamp),
  sk: buildFeedbackSk(params.userId),
});

export async function getMeetingSummaryFeedback(params: {
  channelIdTimestamp: string;
  userId: string;
}) {
  const { pk, sk } = buildMeetingSummaryFeedbackKeys(params);
  return getFeedbackRepository().get(pk, sk);
}

export async function submitMeetingSummaryFeedback(params: {
  guildId: string;
  channelIdTimestamp: string;
  userId: string;
  userTag?: string;
  displayName?: string;
  rating: FeedbackRating;
  comment?: string;
  source?: FeedbackSource;
}) {
  const history = await getMeetingHistoryService(
    params.guildId,
    params.channelIdTimestamp,
  );

  const trimmedComment = params.comment?.trim();
  const comment =
    trimmedComment && trimmedComment.length > 0
      ? trimmedComment.slice(0, MAX_FEEDBACK_COMMENT_LENGTH)
      : undefined;
  const now = nowIso();

  const channelId =
    history?.channelId ?? params.channelIdTimestamp.split("#")[0];
  const record: FeedbackRecord = {
    pk: buildFeedbackPk("meeting_summary", params.channelIdTimestamp),
    sk: buildFeedbackSk(params.userId),
    type: "feedback",
    targetType: "meeting_summary",
    targetId: params.channelIdTimestamp,
    guildId: params.guildId,
    channelId,
    meetingId: history?.meetingId,
    notesVersion: history?.notesVersion,
    summarySentence: history?.summarySentence,
    summaryLabel: history?.summaryLabel,
    rating: params.rating,
    comment,
    source: params.source ?? "discord",
    createdAt: now,
    updatedAt: now,
    userId: params.userId,
    userTag: params.userTag,
    displayName: params.displayName,
  };

  await getFeedbackRepository().write(record);

  return {
    ok: true as const,
    record,
    historyFound: Boolean(history),
  };
}
