import { z } from "zod";
import { router, manageGuildProcedure } from "../trpc";
import {
  clearDictionaryEntriesService,
  listDictionaryEntriesService,
  removeDictionaryEntryService,
  upsertDictionaryEntryService,
} from "../../services/dictionaryService";
import {
  DICTIONARY_DEFINITION_MAX_LENGTH,
  DICTIONARY_TERM_MAX_LENGTH,
} from "../../utils/dictionary";

const serverSchema = z.object({
  serverId: z.string().min(1),
});

export const dictionaryRouter = router({
  list: manageGuildProcedure.input(serverSchema).query(async ({ input }) => {
    const entries = await listDictionaryEntriesService(input.serverId);
    return { entries };
  }),
  upsert: manageGuildProcedure
    .input(
      serverSchema.extend({
        term: z.string().min(1).max(DICTIONARY_TERM_MAX_LENGTH),
        definition: z.string().max(DICTIONARY_DEFINITION_MAX_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await upsertDictionaryEntryService({
        guildId: input.serverId,
        term: input.term,
        definition: input.definition,
        userId: ctx.user!.id,
      });
      return { entry };
    }),
  remove: manageGuildProcedure
    .input(
      serverSchema.extend({
        term: z.string().min(1).max(DICTIONARY_TERM_MAX_LENGTH),
      }),
    )
    .mutation(async ({ input }) => {
      await removeDictionaryEntryService({
        guildId: input.serverId,
        term: input.term,
      });
      return { ok: true };
    }),
  clear: manageGuildProcedure
    .input(serverSchema)
    .mutation(async ({ input }) => {
      await clearDictionaryEntriesService(input.serverId);
      return { ok: true };
    }),
});
