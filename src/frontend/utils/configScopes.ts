import type {
  ConfigScope,
  ConfigScopeConfig,
  ConfigScopeControl,
  ConfigScopeRole,
} from "../../config/types";
import type { ConfigEntryInput } from "../types/configEntry";

export const ALL_CONFIG_SCOPES: ConfigScope[] = [
  "global",
  "server",
  "channel",
  "user",
  "meeting",
];

const defaultRoleForScope = (scope: ConfigScope): ConfigScopeRole =>
  scope === "global" ? "superadmin" : "admin";

const defaultControlForScope = (
  entry: ConfigEntryInput,
  scope: ConfigScope,
): ConfigScopeControl => {
  if (entry.valueType === "boolean") {
    return scope === "global" ? "toggle" : "tri-state";
  }
  if (entry.ui.type === "select") return "select";
  if (entry.ui.type === "number") return "number";
  return "text";
};

export const resolveScopeConfigInput = (
  entry: ConfigEntryInput,
  scope: ConfigScope,
): ConfigScopeConfig => {
  const raw = entry.scopes?.[scope];
  if (!raw || !raw.enabled) {
    return {
      enabled: false,
      required: false,
      role: defaultRoleForScope(scope),
      control: defaultControlForScope(entry, scope),
    };
  }
  return {
    enabled: true,
    required: Boolean(raw.required),
    role: raw.role ?? defaultRoleForScope(scope),
    control: raw.control ?? defaultControlForScope(entry, scope),
    notes: raw.notes,
  };
};

export const formatScopeLabel = (scope: ConfigScope) => {
  switch (scope) {
    case "global":
      return "Global";
    case "server":
      return "Server";
    case "channel":
      return "Channel";
    case "user":
      return "User";
    case "meeting":
      return "Meeting";
    default:
      return scope;
  }
};
