import type {
  ConfigEntry,
  ConfigScope,
  ConfigScopeConfig,
} from "../../config/types";

export type ConfigEntryInput = Omit<ConfigEntry, "scopes"> & {
  scopes?: Partial<Record<ConfigScope, Partial<ConfigScopeConfig>>>;
};
