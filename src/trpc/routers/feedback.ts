import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { guildMemberProcedure, manageGuildProcedure, router } from "../trpc";
import { getAskConversationRepository } from "../../repositories/askConversationRepository";
import { submitAskFeedback } from "../../services/askFeedbackService";
import { submitMeetingSummaryFeedback } from "../../services/summaryFeedbackService";

const ratingSchema = z.enum(["up", "down"]);

// Meeting summaries are posted to shared channels, so feedback is admin-only.
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

// Ask feedback is scoped to the requesting member, so member access is enough.
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

    const repo = getAskConversationRepository();
    const conversation = await repo.getConversation(
      user.id,
      input.serverId,
      input.conversationId,
    );
    if (!conversation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Ask conversation not found.",
      });
    }

    const messages = await repo.listMessages(
      user.id,
      input.serverId,
      input.conversationId,
    );
    const targetMessage = messages.find(
      (message) => message.id === input.messageId,
    );
    if (!targetMessage || targetMessage.role !== "chronote") {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Ask response not found.",
      });
    }

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
