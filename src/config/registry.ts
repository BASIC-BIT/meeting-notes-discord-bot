import type { ConfigEntry, ConfigScopeConfig } from "./types";
import {
  FAST_SILENCE_THRESHOLD,
  MAX_SNIPPET_LENGTH,
  MINIMUM_TRANSCRIPTION_LENGTH,
  SILENCE_THRESHOLD,
} from "../constants";
import { DEFAULT_TTS_VOICE, TTS_VOICES } from "../utils/ttsVoices";

const scope = (
  enabled: boolean,
  required: boolean,
  role: ConfigScopeConfig["role"],
  control: ConfigScopeConfig["control"],
  notes?: string,
): ConfigScopeConfig => ({
  enabled,
  required,
  role,
  control,
  ...(notes ? { notes } : {}),
});

export const CONFIG_REGISTRY: ConfigEntry[] = [
  {
    key: "features.experimental",
    label: "Experimental features",
    description:
      "Allow experimental features for this server, gated by tier where needed.",
    category: "Experimental",
    group: "Experimental",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      server: scope(true, true, "admin", "toggle"),
    },
    ui: { type: "toggle" },
  },
  {
    key: "transcription.premium.enabled",
    label: "Premium transcription",
    description:
      "Enable premium transcription for this server, requires pro tier.",
    category: "Transcription",
    group: "Experimental",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      global: scope(true, true, "superadmin", "toggle"),
      server: scope(true, false, "admin", "tri-state"),
    },
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
    group: "Experimental",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      global: scope(true, true, "superadmin", "toggle"),
      server: scope(true, false, "admin", "tri-state"),
    },
    minTier: "pro",
    requiresExperimentalTag: true,
    ui: { type: "toggle" },
  },
  {
    key: "transcription.premium.coalesce.model",
    label: "Premium coalesce model",
    description: "Model used to coalesce premium transcription outputs.",
    category: "Transcription",
    group: "Experimental",
    valueType: "select",
    defaultValue: "gpt-5-mini",
    scopes: {
      global: scope(true, true, "superadmin", "select"),
      server: scope(true, false, "admin", "select"),
    },
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
    group: "Advanced",
    valueType: "number",
    defaultValue: FAST_SILENCE_THRESHOLD,
    scopes: {
      global: scope(true, true, "superadmin", "number"),
      server: scope(false, false, "admin", "number"),
    },
    ui: { type: "number", min: 100, max: 5000, step: 50 },
  },
  {
    key: "transcription.slowSilenceMs",
    label: "Slow silence threshold (ms)",
    description: "Silence duration before finalizing a transcription snippet.",
    category: "Transcription",
    group: "Advanced",
    valueType: "number",
    defaultValue: SILENCE_THRESHOLD,
    scopes: {
      global: scope(true, true, "superadmin", "number"),
      server: scope(false, false, "admin", "number"),
    },
    ui: { type: "number", min: 500, max: 10000, step: 100 },
  },
  {
    key: "transcription.minSnippetSeconds",
    label: "Minimum snippet seconds",
    description: "Minimum audio length required before transcribing a snippet.",
    category: "Transcription",
    group: "Advanced",
    valueType: "number",
    defaultValue: MINIMUM_TRANSCRIPTION_LENGTH,
    scopes: {
      global: scope(true, true, "superadmin", "number"),
      server: scope(false, false, "admin", "number"),
    },
    ui: { type: "number", min: 0.1, max: 5, step: 0.1 },
  },
  {
    key: "transcription.maxSnippetMs",
    label: "Maximum snippet duration (ms)",
    description:
      "Maximum duration for a single snippet before starting a new one.",
    category: "Transcription",
    group: "Advanced",
    valueType: "number",
    defaultValue: MAX_SNIPPET_LENGTH,
    scopes: {
      global: scope(true, true, "superadmin", "number"),
      server: scope(false, false, "admin", "number"),
    },
    ui: { type: "number", min: 5000, max: 180000, step: 1000 },
  },
  {
    key: "context.instructions",
    label: "Context instructions",
    description: "Context instructions applied to meetings.",
    category: "Context",
    group: "Recommended",
    valueType: "string",
    scopes: {
      server: scope(true, false, "admin", "text"),
      channel: scope(true, false, "admin", "text"),
      meeting: scope(true, false, "admin", "text"),
    },
    ui: {
      type: "text",
      placeholder: "What should Chronote know about this context?",
    },
  },
  {
    key: "notes.channelId",
    label: "Notes channel",
    description: "Default notes channel for meetings and auto-recording.",
    category: "Notes",
    group: "Recommended",
    valueType: "string",
    scopes: {
      server: scope(true, false, "admin", "text"),
      channel: scope(true, false, "admin", "text"),
    },
    ui: { type: "custom", renderer: "NotesChannelSelect" },
  },
  {
    key: "notes.tags",
    label: "Default tags",
    description: "Comma separated tags applied to meetings by default.",
    category: "Notes",
    group: "Recommended",
    valueType: "string",
    scopes: {
      server: scope(true, false, "admin", "text"),
      channel: scope(true, false, "admin", "text"),
    },
    ui: { type: "text", placeholder: "project x, roadmap, weekly" },
  },
  {
    key: "autorecord.enabled",
    label: "Auto-record",
    description: "Automatically record meetings by default.",
    category: "Auto-record",
    group: "Recommended",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      server: scope(true, true, "admin", "toggle"),
      channel: scope(true, false, "admin", "tri-state"),
    },
    ui: { type: "toggle" },
  },
  {
    key: "liveVoice.enabled",
    label: "Live voice responder",
    description: "Enable the live voice responder.",
    category: "Live voice",
    group: "Standard",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      server: scope(true, true, "admin", "toggle"),
      channel: scope(true, false, "admin", "tri-state"),
    },
    ui: { type: "toggle" },
  },
  {
    key: "liveVoice.commands.enabled",
    label: "Live voice commands",
    description: "Enable live voice commands.",
    category: "Live voice",
    group: "Standard",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      server: scope(true, true, "admin", "toggle"),
      channel: scope(true, false, "admin", "tri-state"),
    },
    ui: { type: "toggle" },
  },
  {
    key: "liveVoice.ttsVoice",
    label: "Live voice TTS voice",
    description: "Voice used for live voice responses.",
    category: "Live voice",
    group: "Standard",
    valueType: "select",
    defaultValue: DEFAULT_TTS_VOICE,
    scopes: {
      global: scope(true, true, "superadmin", "select"),
      server: scope(true, false, "admin", "select"),
    },
    ui: {
      type: "custom",
      renderer: "TtsVoiceSelect",
      options: [...TTS_VOICES],
    },
  },
  {
    key: "chatTts.enabled",
    label: "Chat-to-speech",
    description: "Enable chat-to-speech for the server.",
    category: "Chat TTS",
    group: "Standard",
    valueType: "boolean",
    defaultValue: false,
    scopes: {
      server: scope(true, true, "admin", "toggle"),
      channel: scope(true, false, "admin", "tri-state"),
    },
    ui: { type: "toggle" },
  },
  {
    key: "chatTts.voice",
    label: "Chat TTS voice",
    description: "Voice used for chat-to-speech.",
    category: "Chat TTS",
    group: "Standard",
    valueType: "select",
    defaultValue: DEFAULT_TTS_VOICE,
    scopes: {
      global: scope(true, true, "superadmin", "select"),
      server: scope(true, false, "admin", "select"),
    },
    ui: {
      type: "custom",
      renderer: "TtsVoiceSelect",
      options: [...TTS_VOICES],
    },
  },
  {
    key: "ask.members.enabled",
    label: "Ask members",
    description: "Allow Ask to use member data for responses.",
    category: "Ask",
    group: "Standard",
    valueType: "boolean",
    defaultValue: true,
    scopes: {
      server: scope(true, true, "admin", "toggle"),
    },
    ui: { type: "toggle" },
  },
  {
    key: "ask.sharing.policy",
    label: "Ask sharing policy",
    description: "Default sharing policy for Ask conversations.",
    category: "Ask",
    group: "Standard",
    valueType: "select",
    defaultValue: "server",
    scopes: {
      global: scope(true, true, "superadmin", "select"),
      server: scope(true, false, "admin", "select"),
    },
    ui: { type: "segmented", options: ["off", "server", "public"] },
  },
];

export const CONFIG_KEY_SET = new Set(
  CONFIG_REGISTRY.map((entry) => entry.key),
);

export function getConfigEntry(key: string) {
  return CONFIG_REGISTRY.find((entry) => entry.key === key);
}
