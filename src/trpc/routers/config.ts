import { z } from "zod";
import { router, authedProcedure, manageGuildProcedure } from "../trpc";
import { getConfigRegistry } from "../../services/meetingConfigService";
import {
  resolveConfigSnapshot,
  resolveGlobalConfigValues,
} from "../../services/unifiedConfigService";
import {
  clearConfigOverrideForScope,
  listConfigOverridesForScope,
  setConfigOverrideForScope,
} from "../../services/configOverridesService";
import { isSuperAdmin } from "../../services/adminAccessService";
import { resolveGuildSubscription } from "../../services/subscriptionService";
import { getConfigEntry } from "../../config/registry";

const updateValueSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

const keySchema = z.object({
  key: z.string().min(1),
});

const serverSchema = z.object({
  serverId: z.string().min(1),
});

const serverUpdateSchema = serverSchema.merge(updateValueSchema);

export const configRouter = router({
  registry: authedProcedure.query(() => getConfigRegistry()),
  global: authedProcedure.query(async ({ ctx }) => {
    if (!isSuperAdmin(ctx.user?.id)) {
      throw new Error("Super admin access required.");
    }
    const values = await resolveGlobalConfigValues();
    return {
      registry: getConfigRegistry(),
      values,
    };
  }),
  setGlobal: authedProcedure
    .input(updateValueSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isSuperAdmin(ctx.user?.id)) {
        throw new Error("Super admin access required.");
      }
      const entry = getConfigEntry(input.key);
      if (!entry || !entry.scopes.includes("global")) {
        throw new Error("Config key is not global.");
      }
      await setConfigOverrideForScope(
        { scope: "global" },
        input.key,
        input.value,
        ctx.user!.id,
      );
      return { ok: true };
    }),
  clearGlobal: authedProcedure
    .input(keySchema)
    .mutation(async ({ ctx, input }) => {
      if (!isSuperAdmin(ctx.user?.id)) {
        throw new Error("Super admin access required.");
      }
      await clearConfigOverrideForScope({ scope: "global" }, input.key);
      return { ok: true };
    }),
  server: manageGuildProcedure.input(serverSchema).query(async ({ input }) => {
    const subscription = await resolveGuildSubscription(input.serverId);
    const snapshot = await resolveConfigSnapshot({
      guildId: input.serverId,
      tier: subscription.tier,
    });
    const overrides = await listConfigOverridesForScope({
      scope: "server",
      guildId: input.serverId,
    });
    return {
      registry: getConfigRegistry(),
      snapshot,
      overrides,
    };
  }),
  setServerOverride: manageGuildProcedure
    .input(serverUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const entry = getConfigEntry(input.key);
      if (!entry || !entry.scopes.includes("server")) {
        throw new Error("Config key is not server scoped.");
      }
      await setConfigOverrideForScope(
        { scope: "server", guildId: input.serverId },
        input.key,
        input.value,
        ctx.user!.id,
      );
      return { ok: true };
    }),
  clearServerOverride: manageGuildProcedure
    .input(serverSchema.merge(keySchema))
    .mutation(async ({ input }) => {
      await clearConfigOverrideForScope(
        { scope: "server", guildId: input.serverId },
        input.key,
      );
      return { ok: true };
    }),
});
