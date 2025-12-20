import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { answerQuestionService } from "../../services/askService";
import { ensureManageGuildWithUserToken } from "../../services/guildAccessService";
import { authedProcedure, router } from "../trpc";

const ask = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      question: z.string().min(1),
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
    const { answer } = await answerQuestionService({
      guildId: input.serverId,
      channelId: input.channelId ?? "",
      question: input.question,
      tags: input.tags,
      scope: input.scope,
    });
    return { answer };
  });

export const askRouter = router({
  ask,
});
