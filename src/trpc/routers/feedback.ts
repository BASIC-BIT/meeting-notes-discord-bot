import { z } from "zod";
import { guildMemberProcedure, manageGuildProcedure, router } from "../trpc";
import { submitAskFeedback } from "../../services/askFeedbackService";
import { submitMeetingSummaryFeedback } from "../../services/summaryFeedbackService";

const ratingSchema = z.enum(["up", "down"]);

const submitSummary = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      meetingId: z.string(),
      rating: ratingSchema,
      comment: z.string().max(1000).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    const username = user.username;
    const discriminator = user.discriminator;
    const userTag =
      discriminator && discriminator !== "0"
        ? `${username}#${discriminator}`
        : username;
    const displayName = user.global_name ?? username;

    await submitMeetingSummaryFeedback({
      guildId: input.serverId,
      channelIdTimestamp: input.meetingId,
      userId: user.id,
      userTag,
      displayName,
      rating: input.rating,
      comment: input.comment,
      source: "web",
    });

    return { ok: true };
  });

const submitAsk = guildMemberProcedure
  .input(
    z.object({
      serverId: z.string(),
      conversationId: z.string(),
      messageId: z.string(),
      rating: ratingSchema,
      comment: z.string().max(1000).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    const username = user.username;
    const discriminator = user.discriminator;
    const userTag =
      discriminator && discriminator !== "0"
        ? `${username}#${discriminator}`
        : username;
    const displayName = user.global_name ?? username;

    await submitAskFeedback({
      guildId: input.serverId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      userId: user.id,
      userTag,
      displayName,
      rating: input.rating,
      comment: input.comment,
      source: "web",
    });

    return { ok: true };
  });

export const feedbackRouter = router({
  submitSummary,
  submitAsk,
});
