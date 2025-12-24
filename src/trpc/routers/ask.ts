import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  askWithConversation,
  getAskConversationWithMessages,
  listAskConversations,
  renameAskConversation,
} from "../../services/askConversationService";
import { ensureManageGuildWithUserToken } from "../../services/guildAccessService";
import { authedProcedure, router } from "../trpc";

const ask = authedProcedure
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
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
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

const listConversations = authedProcedure
  .input(z.object({ serverId: z.string() }))
  .query(async ({ ctx, input }) => {
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
    const conversations = await listAskConversations(
      ctx.user.id,
      input.serverId,
    );
    return { conversations };
  });

const getConversation = authedProcedure
  .input(z.object({ serverId: z.string(), conversationId: z.string() }))
  .query(async ({ ctx, input }) => {
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
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

const rename = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      conversationId: z.string(),
      title: z.string().min(1).max(120),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const ok = await ensureManageGuildWithUserToken(
      ctx.user.accessToken,
      input.serverId,
    );
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Manage Guild required",
      });
    }
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
