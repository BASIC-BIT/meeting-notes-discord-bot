import { z } from "zod";
import { router, authedProcedure, manageGuildProcedure } from "../trpc";
import { getConfigRegistry } from "../../services/meetingConfigService";
import {
  resolveConfigSnapshot,
  resolveGlobalConfigValues,
  validateGlobalConfigValues,
} from "../../services/unifiedConfigService";
import { getGlobalConfigValues } from "../../services/appConfigService";
import {
  clearConfigOverrideForScope,
  listConfigOverridesForScope,
  setConfigOverrideForScope,
} from "../../services/configOverridesService";
import { isSuperAdmin } from "../../services/adminAccessService";
import { resolveGuildSubscription } from "../../services/subscriptionService";
import { getConfigEntry } from "../../config/registry";
import { coerceConfigValue, resolveNumberRange } from "../../config/validation";
import { publishAppConfigValues } from "../../services/appConfigPublishService";
import { config } from "../../services/configService";
import { resolveScopeConfig } from "../../config/scopeUtils";

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
    const appconfigValues = await getGlobalConfigValues();
    const validation = await validateGlobalConfigValues();
    return {
      registry: getConfigRegistry(),
      values,
      appconfigValues,
      appconfigEnabled: config.appConfig.enabled,
      validation,
    };
  }),
  publishGlobal: authedProcedure
    .input(
      z.object({
        values: z.record(z.string(), z.unknown()),
        description: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isSuperAdmin(ctx.user?.id)) {
        throw new Error("Super admin access required.");
      }
      await publishAppConfigValues({
        values: input.values,
        description: input.description,
      });
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
      const scopeConfig = entry ? resolveScopeConfig(entry, "server") : null;
      if (!entry || !scopeConfig?.enabled) {
        throw new Error("Config key is not server scoped.");
      }
      const coerced = coerceConfigValue(entry, input.value);
      if (!coerced.valid) {
        throw new Error(`Invalid value for ${input.key}`);
      }
      if (entry.valueType === "number") {
        const subscription = await resolveGuildSubscription(input.serverId);
        const snapshot = await resolveConfigSnapshot({
          guildId: input.serverId,
          tier: subscription.tier,
        });
        const valuesByKey: Record<string, unknown> = {};
        Object.entries(snapshot.values).forEach(([key, value]) => {
          valuesByKey[key] = value.value;
        });
        valuesByKey[input.key] = coerced.value;
        const range = resolveNumberRange(entry, valuesByKey);
        if (range.invalidKeys.length > 0) {
          throw new Error(
            `Invalid bounds for ${input.key}: ${range.invalidKeys.join(", ")}`,
          );
        }
        const numericValue = Number(coerced.value);
        if (!Number.isFinite(numericValue)) {
          throw new Error(`Invalid numeric value for ${input.key}`);
        }
        if (range.min !== undefined && numericValue < range.min) {
          throw new Error(`Value for ${input.key} must be >= ${range.min}`);
        }
        if (range.max !== undefined && numericValue > range.max) {
          throw new Error(`Value for ${input.key} must be <= ${range.max}`);
        }
      }
      await setConfigOverrideForScope(
        { scope: "server", guildId: input.serverId },
        input.key,
        coerced.value,
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
