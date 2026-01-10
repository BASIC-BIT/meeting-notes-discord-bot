import type { ConfigScope, ConfigTier } from "../../config/types";

export type ResolvedConfigValueInput = {
  key: string;
  value?: unknown;
  source: ConfigScope | "appconfig" | "default" | "experimental" | "gated";
  gated?: boolean;
};

export type ResolvedConfigSnapshotInput = {
  values: Record<string, ResolvedConfigValueInput>;
  experimentalEnabled: boolean;
  tier?: ConfigTier;
  missingRequired: string[];
};

export type ConfigOverrideInput = {
  configKey: string;
  value?: unknown;
};
