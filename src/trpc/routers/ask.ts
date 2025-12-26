import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  askWithConversation,
  getAskConversationWithMessages,
  listAskConversations,
  renameAskConversation,
} from "../../services/askConversationService";
import { manageGuildProcedure, router } from "../trpc";

const ask = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      question: z.string().min(1),
      conversationId: z.string().optional(),
      tags: z.array(z.string()).optional(),
      scope: z.enum(["guild", "channel"]).optional(),
      channelId: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const result = await askWithConversation({
      userId: ctx.user.id,
      guildId: input.serverId,
      question: input.question,
      conversationId: input.conversationId,
      channelId: input.channelId,
      tags: input.tags,
      scope: input.scope,
    });
    return result;
  });

const listConversations = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    const conversations = await listAskConversations(
      ctx.user.id,
      input.serverId,
    );
    return { conversations };
  });

const getConversation = manageGuildProcedure
  .input(z.object({ serverId: z.string(), conversationId: z.string() }))
  .query(async ({ ctx, input }) => {
    const result = await getAskConversationWithMessages(
      ctx.user.id,
      input.serverId,
      input.conversationId,
    );
    if (!result) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }
    return result;
  });

const rename = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      conversationId: z.string(),
      title: z.string().min(1).max(120),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const updated = await renameAskConversation(
      ctx.user.id,
      input.serverId,
      input.conversationId,
      input.title,
    );
    if (!updated) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }
    return { conversation: updated };
  });

export const askRouter = router({
  ask,
  listConversations,
  getConversation,
  rename,
});
