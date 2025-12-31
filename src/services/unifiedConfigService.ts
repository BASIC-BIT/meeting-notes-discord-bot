import { CONFIG_REGISTRY, getConfigEntry } from "../config/registry";
import type {
  ConfigEntry,
  ConfigScope,
  ConfigTier,
  ResolvedConfigSnapshot,
  ResolvedConfigValue,
} from "../config/types";
import { getGlobalConfigValues } from "./appConfigService";
import { listConfigOverridesForScope } from "./configOverridesService";

const TIER_ORDER: Record<ConfigTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
};

function isTierAllowed(current: ConfigTier | undefined, minTier?: ConfigTier) {
  if (!minTier) return true;
  const currentRank = TIER_ORDER[current ?? "free"] ?? 0;
  return currentRank >= TIER_ORDER[minTier];
}

function coerceValue(
  entry: ConfigEntry,
  value: unknown,
): {
  value: unknown;
  valid: boolean;
} {
  if (entry.valueType === "boolean") {
    if (typeof value === "boolean") return { value, valid: true };
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return { value: true, valid: true };
      if (value.toLowerCase() === "false") return { value: false, valid: true };
    }
    return { value: entry.defaultValue, valid: false };
  }
  if (entry.valueType === "number") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return { value, valid: true };
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return { value: parsed, valid: true };
    }
    return { value: entry.defaultValue, valid: false };
  }
  if (entry.valueType === "select") {
    if (typeof value === "string" && entry.ui.type === "select") {
      if (entry.ui.options.includes(value)) {
        return { value, valid: true };
      }
    }
    return { value: entry.defaultValue, valid: false };
  }
  if (entry.valueType === "string") {
    if (typeof value === "string") return { value, valid: true };
    return { value: entry.defaultValue, valid: false };
  }
  return { value: entry.defaultValue, valid: false };
}

function pickOverrideValue(
  entry: ConfigEntry,
  overrides: Map<string, unknown>,
  scope: ConfigScope,
): { value: unknown; source: ResolvedConfigValue["source"] } | null {
  if (!entry.scopes.includes(scope)) return null;
  if (!overrides.has(entry.key)) return null;
  return { value: overrides.get(entry.key), source: scope };
}

export type ConfigResolveContext = {
  guildId?: string;
  channelId?: string;
  userId?: string;
  meetingId?: string;
  tier?: ConfigTier;
};

export async function resolveConfigSnapshot(
  context: ConfigResolveContext,
): Promise<ResolvedConfigSnapshot> {
  const globalValues = await getGlobalConfigValues();
  const globalOverrides = new Map(
    (await listConfigOverridesForScope({ scope: "global" })).map((record) => [
      record.configKey,
      record.value,
    ]),
  );
  const serverOverrides = context.guildId
    ? new Map(
        (
          await listConfigOverridesForScope({
            scope: "server",
            guildId: context.guildId,
          })
        ).map((record) => [record.configKey, record.value]),
      )
    : new Map<string, unknown>();
  const channelOverrides =
    context.guildId && context.channelId
      ? new Map(
          (
            await listConfigOverridesForScope({
              scope: "channel",
              guildId: context.guildId,
              channelId: context.channelId,
            })
          ).map((record) => [record.configKey, record.value]),
        )
      : new Map<string, unknown>();
  const userOverrides =
    context.guildId && context.userId
      ? new Map(
          (
            await listConfigOverridesForScope({
              scope: "user",
              guildId: context.guildId,
              userId: context.userId,
            })
          ).map((record) => [record.configKey, record.value]),
        )
      : new Map<string, unknown>();
  const meetingOverrides = context.meetingId
    ? new Map(
        (
          await listConfigOverridesForScope({
            scope: "meeting",
            meetingId: context.meetingId,
          })
        ).map((record) => [record.configKey, record.value]),
      )
    : new Map<string, unknown>();

  const values: Record<string, ResolvedConfigValue> = {};
  const rawValues = new Map<
    string,
    { value: unknown; source: ResolvedConfigValue["source"] }
  >();

  CONFIG_REGISTRY.forEach((entry) => {
    let value: unknown = entry.defaultValue;
    let source: ResolvedConfigValue["source"] = "default";

    if (Object.hasOwn(globalValues, entry.key)) {
      value = (globalValues as Record<string, unknown>)[entry.key];
      source = "appconfig";
    }
    if (globalOverrides.has(entry.key)) {
      value = globalOverrides.get(entry.key);
      source = "global_override";
    }

    const serverOverride = pickOverrideValue(entry, serverOverrides, "server");
    if (serverOverride) {
      value = serverOverride.value;
      source = serverOverride.source;
    }
    const channelOverride = pickOverrideValue(
      entry,
      channelOverrides,
      "channel",
    );
    if (channelOverride) {
      value = channelOverride.value;
      source = channelOverride.source;
    }
    const userOverride = pickOverrideValue(entry, userOverrides, "user");
    if (userOverride) {
      value = userOverride.value;
      source = userOverride.source;
    }
    const meetingOverride = pickOverrideValue(
      entry,
      meetingOverrides,
      "meeting",
    );
    if (meetingOverride) {
      value = meetingOverride.value;
      source = meetingOverride.source;
    }

    rawValues.set(entry.key, { value, source });
  });

  const experimentalEntry = getConfigEntry("features.experimental");
  const experimentalRaw =
    experimentalEntry && rawValues.has("features.experimental")
      ? rawValues.get("features.experimental")?.value
      : false;
  const experimentalEnabled =
    experimentalEntry && experimentalRaw !== undefined
      ? Boolean(coerceValue(experimentalEntry, experimentalRaw).value)
      : false;

  CONFIG_REGISTRY.forEach((entry) => {
    const raw = rawValues.get(entry.key);
    const base = raw?.value ?? entry.defaultValue;
    const baseSource = raw?.source ?? "default";
    const coerced = coerceValue(entry, base);

    let value = coerced.value;
    let source: ResolvedConfigValue["source"] = baseSource;
    let gated = false;

    if (!coerced.valid) {
      value = entry.defaultValue;
      source = "default";
    }

    if (entry.requiresExperimentalTag && !experimentalEnabled) {
      value = entry.defaultValue;
      source = "gated";
      gated = true;
    }
    if (!isTierAllowed(context.tier, entry.minTier)) {
      value = entry.defaultValue;
      source = "gated";
      gated = true;
    }

    values[entry.key] = {
      key: entry.key,
      value,
      source,
      gated,
    };
  });

  return {
    values,
    experimentalEnabled,
    tier: context.tier,
  };
}

export async function resolveGlobalConfigValues(): Promise<
  ResolvedConfigValue[]
> {
  const globalValues = await getGlobalConfigValues();
  const globalOverrides = new Map(
    (await listConfigOverridesForScope({ scope: "global" })).map((record) => [
      record.configKey,
      record.value,
    ]),
  );

  return CONFIG_REGISTRY.map((entry) => {
    let value: unknown = entry.defaultValue;
    let source: ResolvedConfigValue["source"] = "default";

    if (Object.hasOwn(globalValues, entry.key)) {
      value = (globalValues as Record<string, unknown>)[entry.key];
      source = "appconfig";
    }
    if (globalOverrides.has(entry.key)) {
      value = globalOverrides.get(entry.key);
      source = "global_override";
    }

    const coerced = coerceValue(entry, value);
    if (!coerced.valid) {
      value = entry.defaultValue;
      source = "default";
    } else {
      value = coerced.value;
    }

    return {
      key: entry.key,
      value,
      source,
    };
  });
}
