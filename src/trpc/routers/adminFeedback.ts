import { z } from "zod";
import { superAdminProcedure, router } from "../trpc";
import { listFeedbackEntries } from "../../services/adminFeedbackService";

const targetTypeSchema = z.enum(["meeting_summary", "ask_answer"]);
const ratingSchema = z.enum(["up", "down"]);
const sourceSchema = z.enum(["discord", "web"]);

const list = superAdminProcedure
  .input(
    z.object({
      targetType: targetTypeSchema.optional(),
      rating: ratingSchema.optional(),
      source: sourceSchema.optional(),
      limit: z.number().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }),
  )
  .query(async ({ input }) => {
    const result = await listFeedbackEntries({
      targetType: input.targetType,
      rating: input.rating,
      source: input.source,
      limit: input.limit,
      cursor: input.cursor,
    });

    return { items: result.items, nextCursor: result.nextCursor };
  });

export const adminFeedbackRouter = router({
  list,
});
