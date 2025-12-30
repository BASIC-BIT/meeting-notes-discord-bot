export type ConfigScope = "global" | "server" | "channel" | "user" | "meeting";

export type ConfigValueType = "boolean" | "string" | "number" | "select";

export type ConfigTier = "free" | "basic" | "pro";

export type ConfigUiControl =
  | { type: "toggle" }
  | { type: "text" }
  | { type: "number"; min?: number; max?: number; step?: number }
  | { type: "select"; options: string[] };

export type ConfigEntry = {
  key: string;
  label: string;
  description: string;
  category: string;
  valueType: ConfigValueType;
  defaultValue: unknown;
  scopes: ConfigScope[];
  minTier?: ConfigTier;
  requiresExperimentalTag?: boolean;
  ui: ConfigUiControl;
};

export type ConfigOverrideValue = {
  key: string;
  value: unknown;
  scope: ConfigScope;
};

export type ResolvedConfigValue = {
  key: string;
  value: unknown;
  source: ConfigScope | "default" | "appconfig" | "global_override" | "gated";
  gated?: boolean;
};

export type ResolvedConfigSnapshot = {
  values: Record<string, ResolvedConfigValue>;
  experimentalEnabled: boolean;
  tier?: ConfigTier;
};

export type MeetingRuntimeConfig = {
  transcription: {
    fastSilenceMs: number;
    slowSilenceMs: number;
    minSnippetSeconds: number;
    maxSnippetMs: number;
  };
  premiumTranscription: {
    enabled: boolean;
    cleanupEnabled: boolean;
    coalesceModel: string;
  };
};
