export const CONFIG_KEYS = {
  features: {
    experimental: "features.experimental",
  },
  transcription: {
    premiumEnabled: "transcription.premium.enabled",
    premiumCleanupEnabled: "transcription.premium.cleanup.enabled",
    premiumCoalesceModel: "transcription.premium.coalesce.model",
    fastSilenceMs: "transcription.fastSilenceMs",
    slowSilenceMs: "transcription.slowSilenceMs",
    minSnippetSeconds: "transcription.minSnippetSeconds",
    maxSnippetMs: "transcription.maxSnippetMs",
  },
  context: {
    instructions: "context.instructions",
  },
  notes: {
    channelId: "notes.channelId",
    tags: "notes.tags",
  },
  autorecord: {
    enabled: "autorecord.enabled",
  },
  liveVoice: {
    enabled: "liveVoice.enabled",
    commandsEnabled: "liveVoice.commands.enabled",
    ttsVoice: "liveVoice.ttsVoice",
  },
  chatTts: {
    enabled: "chatTts.enabled",
    voice: "chatTts.voice",
  },
  ask: {
    membersEnabled: "ask.members.enabled",
    sharingPolicy: "ask.sharing.policy",
  },
} as const;

export const SERVER_CONTEXT_KEYS = {
  context: CONFIG_KEYS.context.instructions,
  defaultNotesChannelId: CONFIG_KEYS.notes.channelId,
  defaultTags: CONFIG_KEYS.notes.tags,
  liveVoiceEnabled: CONFIG_KEYS.liveVoice.enabled,
  liveVoiceCommandsEnabled: CONFIG_KEYS.liveVoice.commandsEnabled,
  liveVoiceTtsVoice: CONFIG_KEYS.liveVoice.ttsVoice,
  chatTtsEnabled: CONFIG_KEYS.chatTts.enabled,
  chatTtsVoice: CONFIG_KEYS.chatTts.voice,
  askMembersEnabled: CONFIG_KEYS.ask.membersEnabled,
  askSharingPolicy: CONFIG_KEYS.ask.sharingPolicy,
} as const;

export const SERVER_CONTEXT_KEY_LIST = Object.values(SERVER_CONTEXT_KEYS);
