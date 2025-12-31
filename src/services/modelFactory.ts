import { config } from "./configService";

export type ModelProvider = "openai";

export type ModelRole =
  | "notes"
  | "meetingSummary"
  | "notesCorrection"
  | "transcription"
  | "transcriptionCleanup"
  | "transcriptionCoalesce"
  | "image"
  | "ask"
  | "liveVoiceGate"
  | "liveVoiceResponder"
  | "liveVoiceTts";

export type ModelChoice = {
  provider: ModelProvider;
  model: string;
};

export type ModelOverrides = Partial<Record<ModelRole, ModelChoice>>;

const defaultModels: Record<ModelRole, ModelChoice> = {
  notes: { provider: "openai", model: config.notes.model },
  meetingSummary: { provider: "openai", model: config.notes.model },
  notesCorrection: { provider: "openai", model: config.notes.model },
  transcription: { provider: "openai", model: "gpt-4o-transcribe" },
  transcriptionCleanup: { provider: "openai", model: config.notes.model },
  transcriptionCoalesce: { provider: "openai", model: "gpt-5-mini" },
  image: { provider: "openai", model: "dall-e-3" },
  ask: { provider: "openai", model: config.liveVoice.responderModel },
  liveVoiceGate: { provider: "openai", model: config.liveVoice.gateModel },
  liveVoiceResponder: {
    provider: "openai",
    model: config.liveVoice.responderModel,
  },
  liveVoiceTts: { provider: "openai", model: config.liveVoice.ttsModel },
};

export function getModelChoice(
  role: ModelRole,
  overrides?: ModelOverrides,
): ModelChoice {
  return overrides?.[role] ?? defaultModels[role];
}
