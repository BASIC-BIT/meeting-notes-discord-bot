import type {
  ConfigEntry,
  ConfigScope,
  ConfigScopeConfig,
  ConfigScopeControl,
} from "./types";

export const ALL_CONFIG_SCOPES: ConfigScope[] = [
  "global",
  "server",
  "channel",
  "user",
  "meeting",
];

const DEFAULT_SCOPE_CONTROL: Record<ConfigScope, ConfigScopeControl> = {
  global: "toggle",
  server: "toggle",
  channel: "toggle",
  user: "toggle",
  meeting: "toggle",
};

export const resolveScopeConfig = (
  entry: ConfigEntry,
  scope: ConfigScope,
): ConfigScopeConfig => {
  const raw = entry.scopes?.[scope];
  if (!raw || !raw.enabled) {
    return {
      enabled: false,
      required: false,
      role: "admin",
      control: DEFAULT_SCOPE_CONTROL[scope],
    };
  }
  return {
    enabled: true,
    required: Boolean(raw.required),
    role: raw.role ?? (scope === "global" ? "superadmin" : "admin"),
    control: raw.control ?? DEFAULT_SCOPE_CONTROL[scope],
    notes: raw.notes,
  };
};

export const isScopeEnabled = (entry: ConfigEntry, scope: ConfigScope) =>
  resolveScopeConfig(entry, scope).enabled;

export const isScopeRequired = (entry: ConfigEntry, scope: ConfigScope) =>
  resolveScopeConfig(entry, scope).required;
