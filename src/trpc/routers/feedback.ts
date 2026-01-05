import { z } from "zod";
import { manageGuildProcedure, router } from "../trpc";
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

    await submitMeetingSummaryFeedback({
      guildId: input.serverId,
      channelIdTimestamp: input.meetingId,
      userId: user.id,
      userTag,
      displayName: username,
      rating: input.rating,
      comment: input.comment,
      source: "web",
    });

    return { ok: true };
  });

export const feedbackRouter = router({
  submitSummary,
});
