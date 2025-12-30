import type { AutoRecordSettings, ChannelContext } from "../../types/db";

export type ChannelOption = {
  value: string;
  label: string;
  botAccess: boolean;
  missingPermissions: string[];
};

export type ChannelOverride = {
  channelId: string;
  voiceLabel: string;
  textLabel?: string;
  textChannelId?: string;
  tags?: string[];
  context?: string;
  autoRecordEnabled: boolean;
  liveVoiceEnabled?: boolean;
  liveVoiceCommandsEnabled?: boolean;
  chatTtsEnabled?: boolean;
};

type ChannelOverrideSource = {
  rule?: AutoRecordSettings;
  context?: ChannelContext;
};

export const formatChannelLabel = (channel: ChannelOption) =>
  channel.botAccess ? channel.label : `${channel.label} (bot access needed)`;

export const mergeOverrideSources = (
  channelRules: AutoRecordSettings[],
  channelContexts: ChannelContext[],
) => {
  const merged = new Map<string, ChannelOverrideSource>();
  channelRules.forEach((rule) => merged.set(rule.channelId, { rule }));
  channelContexts.forEach((context) => {
    const existing = merged.get(context.channelId) ?? {};
    merged.set(context.channelId, { ...existing, context });
  });
  return merged;
};

export const resolveVoiceLabel = (
  voiceChannelMap: Map<string, string>,
  channelId: string,
) => voiceChannelMap.get(channelId) ?? "Unknown channel";

export const resolveTextChannelId = (
  rule: AutoRecordSettings | undefined,
  defaultNotesChannelId: string | null,
) => rule?.textChannelId ?? defaultNotesChannelId ?? undefined;

export const resolveOverrideTextLabel = (options: {
  rule?: AutoRecordSettings;
  resolvedTextChannelId?: string;
  textChannelMap: Map<string, string>;
  defaultNotesChannelId: string | null;
}) => {
  const { rule, resolvedTextChannelId, textChannelMap, defaultNotesChannelId } =
    options;
  if (!rule) return undefined;
  const label = textChannelMap.get(resolvedTextChannelId ?? "");
  if (label) return label;
  return defaultNotesChannelId ? "Default notes channel" : "Unknown channel";
};

const toChannelOverride = (options: {
  channelId: string;
  entry: ChannelOverrideSource;
  voiceChannelMap: Map<string, string>;
  textChannelMap: Map<string, string>;
  defaultNotesChannelId: string | null;
}): ChannelOverride => {
  const {
    channelId,
    entry,
    voiceChannelMap,
    textChannelMap,
    defaultNotesChannelId,
  } = options;
  const voiceLabel = resolveVoiceLabel(voiceChannelMap, channelId);
  const resolvedTextChannelId = resolveTextChannelId(
    entry.rule,
    defaultNotesChannelId,
  );
  const textLabel = resolveOverrideTextLabel({
    rule: entry.rule,
    resolvedTextChannelId,
    textChannelMap,
    defaultNotesChannelId,
  });
  return {
    channelId,
    voiceLabel,
    textLabel,
    textChannelId: entry.rule?.textChannelId,
    tags: entry.rule?.tags,
    context: entry.context?.context,
    autoRecordEnabled: Boolean(entry.rule?.enabled),
    liveVoiceEnabled: entry.context?.liveVoiceEnabled,
    liveVoiceCommandsEnabled: entry.context?.liveVoiceCommandsEnabled,
    chatTtsEnabled: entry.context?.chatTtsEnabled,
  };
};

export const sortOverridesByLabel = (
  left: ChannelOverride,
  right: ChannelOverride,
) => left.voiceLabel.localeCompare(right.voiceLabel);

export const buildChannelOverrides = (options: {
  channelRules: AutoRecordSettings[];
  channelContexts: ChannelContext[];
  voiceChannelMap: Map<string, string>;
  textChannelMap: Map<string, string>;
  defaultNotesChannelId: string | null;
}): ChannelOverride[] => {
  const {
    channelRules,
    channelContexts,
    voiceChannelMap,
    textChannelMap,
    defaultNotesChannelId,
  } = options;
  const merged = mergeOverrideSources(channelRules, channelContexts);
  return Array.from(merged.entries())
    .map(([channelId, entry]) =>
      toChannelOverride({
        channelId,
        entry,
        voiceChannelMap,
        textChannelMap,
        defaultNotesChannelId,
      }),
    )
    .sort(sortOverridesByLabel);
};

export const resolveDefaultNotesChannelId = (options: {
  contextData?: {
    defaultNotesChannelId?: string | null;
  } | null;
  recordAllRule: AutoRecordSettings | null;
}) => {
  const { contextData, recordAllRule } = options;
  return (
    contextData?.defaultNotesChannelId ?? recordAllRule?.textChannelId ?? null
  );
};
