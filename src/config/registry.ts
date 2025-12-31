import type { ConfigEntry } from "./types";

export const CONFIG_REGISTRY: ConfigEntry[] = [
  {
    key: "features.experimental",
    label: "Experimental features",
    description:
      "Allow experimental features for this server, gated by tier where needed.",
    category: "Experimental",
    valueType: "boolean",
    defaultValue: false,
    scopes: ["server"],
    ui: { type: "toggle" },
  },
  {
    key: "transcription.premium.enabled",
    label: "Premium transcription",
    description:
      "Enable premium transcription for this server, requires pro tier.",
    category: "Transcription",
    valueType: "boolean",
    defaultValue: false,
    scopes: ["global", "server"],
    minTier: "pro",
    requiresExperimentalTag: true,
    ui: { type: "toggle" },
  },
  {
    key: "transcription.premium.cleanup.enabled",
    label: "Premium cleanup pass",
    description:
      "Run the transcription cleanup pass for premium transcription.",
    category: "Transcription",
    valueType: "boolean",
    defaultValue: true,
    scopes: ["global", "server"],
    minTier: "pro",
    requiresExperimentalTag: true,
    ui: { type: "toggle" },
  },
  {
    key: "transcription.premium.coalesce.model",
    label: "Premium coalesce model",
    description: "Model used to coalesce premium transcription outputs.",
    category: "Transcription",
    valueType: "select",
    defaultValue: "gpt-5-mini",
    scopes: ["global", "server"],
    minTier: "pro",
    requiresExperimentalTag: true,
    ui: {
      type: "select",
      options: ["gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"],
    },
  },
  {
    key: "transcription.fastSilenceMs",
    label: "Fast silence threshold (ms)",
    description: "Silence duration before running the fast transcription pass.",
    category: "Transcription",
    valueType: "number",
    defaultValue: 400,
    scopes: ["global", "server"],
    ui: { type: "number", min: 100, max: 5000, step: 50 },
  },
  {
    key: "transcription.slowSilenceMs",
    label: "Slow silence threshold (ms)",
    description: "Silence duration before finalizing a transcription snippet.",
    category: "Transcription",
    valueType: "number",
    defaultValue: 2000,
    scopes: ["global", "server"],
    ui: { type: "number", min: 500, max: 10000, step: 100 },
  },
  {
    key: "transcription.minSnippetSeconds",
    label: "Minimum snippet seconds",
    description: "Minimum audio length required before transcribing a snippet.",
    category: "Transcription",
    valueType: "number",
    defaultValue: 0.3,
    scopes: ["global", "server"],
    ui: { type: "number", min: 0.1, max: 5, step: 0.1 },
  },
  {
    key: "transcription.maxSnippetMs",
    label: "Maximum snippet duration (ms)",
    description:
      "Maximum duration for a single snippet before starting a new one.",
    category: "Transcription",
    valueType: "number",
    defaultValue: 60000,
    scopes: ["global", "server"],
    ui: { type: "number", min: 5000, max: 180000, step: 1000 },
  },
];

export const CONFIG_KEY_SET = new Set(
  CONFIG_REGISTRY.map((entry) => entry.key),
);

export function getConfigEntry(key: string) {
  return CONFIG_REGISTRY.find((entry) => entry.key === key);
}
