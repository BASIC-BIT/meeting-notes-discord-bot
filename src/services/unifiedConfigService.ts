import { CONFIG_KEYS } from "../config/keys";
import { CONFIG_REGISTRY, getConfigEntry } from "../config/registry";
import { ALL_CONFIG_SCOPES, resolveScopeConfig } from "../config/scopeUtils";
import type {
  ConfigEntry,
  ConfigScope,
  ConfigTier,
  ResolvedConfigSnapshot,
  ResolvedConfigValue,
} from "../config/types";
import { coerceConfigValue } from "../config/validation";
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

type OverrideMaps = {
  server: Map<string, unknown>;
  channel: Map<string, unknown>;
  user: Map<string, unknown>;
  meeting: Map<string, unknown>;
};

const EMPTY_MAP = new Map<string, unknown>();

export type ConfigResolveContext = {
  guildId?: string;
  channelId?: string;
  userId?: string;
  meetingId?: string;
  tier?: ConfigTier;
};

const resolveScopeChain = (context: ConfigResolveContext): ConfigScope[] => {
  if (context.meetingId) {
    return ["meeting", "channel", "server", "global"];
  }
  if (context.channelId) {
    return ["channel", "server", "global"];
  }
  if (context.userId) {
    return ["user", "server", "global"];
  }
  if (context.guildId) {
    return ["server", "global"];
  }
  return ["global"];
};

const resolveScopeOverrides = async (
  context: ConfigResolveContext,
): Promise<OverrideMaps> => {
  const serverOverrides = context.guildId
    ? new Map(
        (
          await listConfigOverridesForScope({
            scope: "server",
            guildId: context.guildId,
          })
        ).map((record) => [record.configKey, record.value]),
      )
    : EMPTY_MAP;
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
      : EMPTY_MAP;
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
      : EMPTY_MAP;
  const meetingOverrides = context.meetingId
    ? new Map(
        (
          await listConfigOverridesForScope({
            scope: "meeting",
            meetingId: context.meetingId,
          })
        ).map((record) => [record.configKey, record.value]),
      )
    : EMPTY_MAP;

  return {
    server: serverOverrides,
    channel: channelOverrides,
    user: userOverrides,
    meeting: meetingOverrides,
  };
};

const resolveEntryValue = (params: {
  entry: ConfigEntry;
  chain: ConfigScope[];
  overrides: OverrideMaps;
  globalValues: Record<string, unknown>;
  missingRequired: Set<string>;
}): { value: unknown; source: ResolvedConfigValue["source"] } | null => {
  const { entry, chain, overrides, globalValues, missingRequired } = params;
  const hasDefault = entry.defaultValue !== undefined;

  for (const scope of chain) {
    const scopeConfig = resolveScopeConfig(entry, scope);
    if (!scopeConfig.enabled) continue;

    if (scope === "global") {
      if (Object.hasOwn(globalValues, entry.key)) {
        return {
          value: (globalValues as Record<string, unknown>)[entry.key],
          source: "appconfig",
        };
      }
      if (scopeConfig.required && !hasDefault) {
        missingRequired.add(entry.key);
      }
      continue;
    }

    const map = overrides[scope] ?? EMPTY_MAP;
    if (map.has(entry.key)) {
      return { value: map.get(entry.key), source: scope };
    }
    if (scopeConfig.required && !hasDefault) {
      missingRequired.add(entry.key);
    }
  }

  if (hasDefault) {
    return { value: entry.defaultValue, source: "default" };
  }

  return null;
};

export async function resolveConfigSnapshot(
  context: ConfigResolveContext,
): Promise<ResolvedConfigSnapshot> {
  const chain = resolveScopeChain(context);
  const globalValues = await getGlobalConfigValues();
  const overrides = await resolveScopeOverrides(context);
  const missingRequired = new Set<string>();

  const values: Record<string, ResolvedConfigValue> = {};

  const experimentalEntry = getConfigEntry(CONFIG_KEYS.features.experimental);
  const experimentalResolved = experimentalEntry
    ? resolveEntryValue({
        entry: experimentalEntry,
        chain,
        overrides,
        globalValues,
        missingRequired,
      })
    : null;
  let experimentalEnabled = false;
  if (experimentalEntry && experimentalResolved) {
    const experimentalCoerced = coerceConfigValue(
      experimentalEntry,
      experimentalResolved.value,
    );
    if (!experimentalCoerced.valid) {
      throw new Error(
        `Invalid value for ${CONFIG_KEYS.features.experimental}.`,
      );
    }
    experimentalEnabled = Boolean(experimentalCoerced.value);
  }

  CONFIG_REGISTRY.forEach((entry) => {
    const resolved = resolveEntryValue({
      entry,
      chain,
      overrides,
      globalValues,
      missingRequired,
    });

    const fallbackSource: ResolvedConfigValue["source"] =
      resolved?.source ??
      (entry.defaultValue === undefined ? "appconfig" : "default");
    let value = resolved?.value ?? entry.defaultValue;
    let source: ResolvedConfigValue["source"] = fallbackSource;
    let gated = false;

    if (value !== undefined) {
      const coerced = coerceConfigValue(entry, value);
      if (!coerced.valid) {
        throw new Error(`Invalid value for ${entry.key}.`);
      }
      value = coerced.value;
    }

    if (
      experimentalEnabled &&
      entry.experimentalValue !== undefined &&
      (source === "appconfig" || source === "default")
    ) {
      const experimentalCoerced = coerceConfigValue(
        entry,
        entry.experimentalValue,
      );
      if (!experimentalCoerced.valid) {
        throw new Error(`Invalid experimental value for ${entry.key}.`);
      }
      value = experimentalCoerced.value;
      source = "experimental";
      missingRequired.delete(entry.key);
    }

    if (entry.requiresExperimentalTag && !experimentalEnabled) {
      if (entry.valueType === "boolean") {
        value = false;
      }
      source = "gated";
      gated = true;
    }
    if (!isTierAllowed(context.tier, entry.minTier)) {
      if (entry.valueType === "boolean") {
        value = false;
      }
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
    missingRequired: Array.from(missingRequired),
  };
}

export async function resolveGlobalConfigValues(): Promise<
  ResolvedConfigValue[]
> {
  const globalValues = await getGlobalConfigValues();
  const resolved: ResolvedConfigValue[] = [];

  CONFIG_REGISTRY.forEach((entry) => {
    const scopeConfig = resolveScopeConfig(entry, "global");
    if (!scopeConfig.enabled) {
      return;
    }

    if (!Object.hasOwn(globalValues, entry.key)) {
      if (entry.defaultValue !== undefined) {
        const coerced = coerceConfigValue(entry, entry.defaultValue);
        if (!coerced.valid) {
          throw new Error(`Invalid default value for ${entry.key}.`);
        }
        resolved.push({
          key: entry.key,
          value: coerced.value,
          source: "default",
        });
        return;
      }
      resolved.push({
        key: entry.key,
        value: undefined,
        source: "appconfig",
      });
      return;
    }

    const rawValue = (globalValues as Record<string, unknown>)[entry.key];
    const coerced = coerceConfigValue(entry, rawValue);
    if (!coerced.valid) {
      throw new Error(`Invalid value for ${entry.key}.`);
    }
    resolved.push({
      key: entry.key,
      value: coerced.value,
      source: "appconfig",
    });
  });

  return resolved;
}

export async function validateGlobalConfigValues() {
  const globalValues = await getGlobalConfigValues();
  const missingRequired = CONFIG_REGISTRY.filter((entry) => {
    const scopeConfig = resolveScopeConfig(entry, "global");
    if (!scopeConfig.enabled || !scopeConfig.required) return false;
    if (entry.defaultValue !== undefined) return false;
    return !Object.hasOwn(globalValues, entry.key);
  }).map((entry) => entry.key);

  return {
    missingRequired,
  };
}

export function listRequiredScopesForEntry(entry: ConfigEntry) {
  return ALL_CONFIG_SCOPES.filter(
    (scope) => resolveScopeConfig(entry, scope).required,
  );
}
