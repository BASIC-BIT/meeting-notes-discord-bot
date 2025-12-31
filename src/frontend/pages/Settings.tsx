import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import FormSelect from "../components/FormSelect";
import { trpc } from "../services/trpc";
import { uiOverlays } from "../uiTokens";
import { parseTags } from "../../utils/tags";

import {
  buildChannelOverrides,
  formatChannelLabel,
  resolveDefaultNotesChannelId,
  type ChannelOption,
  type ChannelOverride,
} from "../utils/settingsChannels";
import type { AutoRecordSettings } from "../../types/db";
import { AskSharingCard } from "../features/settings/AskSharingCard";
import { GlobalDefaultsCard } from "../features/settings/GlobalDefaultsCard";
import { ChannelOverridesCard } from "../features/settings/ChannelOverridesCard";

type GlobalContextData = {
  context?: string | null;
  defaultTags?: string[] | null;
  defaultNotesChannelId?: string | null;
  liveVoiceEnabled?: boolean | null;
  liveVoiceCommandsEnabled?: boolean | null;
  liveVoiceTtsVoice?: string | null;
  chatTtsEnabled?: boolean | null;
  chatTtsVoice?: string | null;
  askMembersEnabled?: boolean | null;
  askSharingPolicy?: "off" | "server" | "public" | null;
};

export type AskSharingPolicy = "off" | "server" | "public";

const resolveDefaultTags = (contextData?: GlobalContextData | null) =>
  (contextData?.defaultTags ?? []).join(", ");

const resolveAskMembersEnabled = (contextData?: GlobalContextData | null) =>
  contextData?.askMembersEnabled ?? true;

const resolveAskSharingPolicy = (contextData?: GlobalContextData | null) =>
  contextData?.askSharingPolicy ?? "server";

const coalesce = <T,>(value: T | null | undefined, fallback: T) =>
  value ?? fallback;

const resetGlobalDefaults = (options: {
  setServerContext: (value: string) => void;
  setDefaultTags: (value: string) => void;
  setDefaultNotesChannelId: (value: string | null) => void;
  setGlobalLiveVoiceEnabled: (value: boolean) => void;
  setGlobalLiveVoiceCommandsEnabled: (value: boolean) => void;
  setGlobalLiveVoiceTtsVoice: (value: string | null) => void;
  setGlobalChatTtsEnabled: (value: boolean) => void;
  setGlobalChatTtsVoice: (value: string | null) => void;
  setRecordAllEnabled: (value: boolean) => void;
  setGlobalDirty: (value: boolean) => void;
}) => {
  const {
    setServerContext,
    setDefaultTags,
    setDefaultNotesChannelId,
    setGlobalLiveVoiceEnabled,
    setGlobalLiveVoiceCommandsEnabled,
    setGlobalLiveVoiceTtsVoice,
    setGlobalChatTtsEnabled,
    setGlobalChatTtsVoice,
    setRecordAllEnabled,
    setGlobalDirty,
  } = options;
  setServerContext("");
  setDefaultNotesChannelId(null);
  setDefaultTags("");
  setGlobalLiveVoiceEnabled(false);
  setGlobalLiveVoiceCommandsEnabled(false);
  setGlobalLiveVoiceTtsVoice(null);
  setGlobalChatTtsEnabled(false);
  setGlobalChatTtsVoice(null);
  setRecordAllEnabled(false);
  setGlobalDirty(false);
};

const applyGlobalDefaults = (options: {
  contextData: GlobalContextData;
  recordAllRule: AutoRecordSettings | null;
  setServerContext: (value: string) => void;
  setDefaultTags: (value: string) => void;
  setDefaultNotesChannelId: (value: string | null) => void;
  setGlobalLiveVoiceEnabled: (value: boolean) => void;
  setGlobalLiveVoiceCommandsEnabled: (value: boolean) => void;
  setGlobalLiveVoiceTtsVoice: (value: string | null) => void;
  setGlobalChatTtsEnabled: (value: boolean) => void;
  setGlobalChatTtsVoice: (value: string | null) => void;
  setRecordAllEnabled: (value: boolean) => void;
}) => {
  const {
    contextData,
    recordAllRule,
    setServerContext,
    setDefaultTags,
    setDefaultNotesChannelId,
    setGlobalLiveVoiceEnabled,
    setGlobalLiveVoiceCommandsEnabled,
    setGlobalLiveVoiceTtsVoice,
    setGlobalChatTtsEnabled,
    setGlobalChatTtsVoice,
    setRecordAllEnabled,
  } = options;
  setServerContext(coalesce(contextData.context, ""));
  setDefaultTags(resolveDefaultTags(contextData));
  setDefaultNotesChannelId(
    resolveDefaultNotesChannelId({ contextData, recordAllRule }),
  );
  setGlobalLiveVoiceEnabled(coalesce(contextData.liveVoiceEnabled, false));
  setGlobalLiveVoiceCommandsEnabled(
    coalesce(contextData.liveVoiceCommandsEnabled, false),
  );
  setGlobalLiveVoiceTtsVoice(coalesce(contextData.liveVoiceTtsVoice, null));
  setGlobalChatTtsEnabled(coalesce(contextData.chatTtsEnabled, false));
  setGlobalChatTtsVoice(coalesce(contextData.chatTtsVoice, null));
  setRecordAllEnabled(Boolean(recordAllRule));
};

const syncGlobalDefaults = (options: {
  selectedGuildId: string | null;
  contextData?: GlobalContextData | null;
  recordAllRule: AutoRecordSettings | null;
  globalDirty: boolean;
  setServerContext: (value: string) => void;
  setDefaultTags: (value: string) => void;
  setDefaultNotesChannelId: (value: string | null) => void;
  setGlobalLiveVoiceEnabled: (value: boolean) => void;
  setGlobalLiveVoiceCommandsEnabled: (value: boolean) => void;
  setGlobalLiveVoiceTtsVoice: (value: string | null) => void;
  setGlobalChatTtsEnabled: (value: boolean) => void;
  setGlobalChatTtsVoice: (value: string | null) => void;
  setRecordAllEnabled: (value: boolean) => void;
  setGlobalDirty: (value: boolean) => void;
}) => {
  const {
    selectedGuildId,
    contextData,
    recordAllRule,
    globalDirty,
    setServerContext,
    setDefaultTags,
    setDefaultNotesChannelId,
    setGlobalLiveVoiceEnabled,
    setGlobalLiveVoiceCommandsEnabled,
    setGlobalLiveVoiceTtsVoice,
    setGlobalChatTtsEnabled,
    setGlobalChatTtsVoice,
    setRecordAllEnabled,
    setGlobalDirty,
  } = options;

  if (!selectedGuildId) {
    resetGlobalDefaults({
      setServerContext,
      setDefaultNotesChannelId,
      setDefaultTags,
      setGlobalLiveVoiceEnabled,
      setGlobalLiveVoiceCommandsEnabled,
      setGlobalLiveVoiceTtsVoice,
      setGlobalChatTtsEnabled,
      setGlobalChatTtsVoice,
      setRecordAllEnabled,
      setGlobalDirty,
    });
    return;
  }
  if (!contextData || globalDirty) return;
  applyGlobalDefaults({
    contextData,
    recordAllRule,
    setServerContext,
    setDefaultTags,
    setDefaultNotesChannelId,
    setGlobalLiveVoiceEnabled,
    setGlobalLiveVoiceCommandsEnabled,
    setGlobalLiveVoiceTtsVoice,
    setGlobalChatTtsEnabled,
    setGlobalChatTtsVoice,
    setRecordAllEnabled,
  });
};

const resetAskSettings = (options: {
  setAskMembersEnabled: (value: boolean) => void;
  setAskSharingPolicy: (value: AskSharingPolicy) => void;
  setAskDirty: (value: boolean) => void;
}) => {
  const { setAskMembersEnabled, setAskSharingPolicy, setAskDirty } = options;
  setAskMembersEnabled(true);
  setAskSharingPolicy("server");
  setAskDirty(false);
};

const applyAskSettings = (options: {
  contextData: GlobalContextData;
  setAskMembersEnabled: (value: boolean) => void;
  setAskSharingPolicy: (value: AskSharingPolicy) => void;
}) => {
  const { contextData, setAskMembersEnabled, setAskSharingPolicy } = options;
  setAskMembersEnabled(resolveAskMembersEnabled(contextData));
  setAskSharingPolicy(resolveAskSharingPolicy(contextData));
};

const syncAskSettings = (options: {
  selectedGuildId: string | null;
  contextData?: GlobalContextData | null;
  askDirty: boolean;
  setAskMembersEnabled: (value: boolean) => void;
  setAskSharingPolicy: (value: AskSharingPolicy) => void;
  setAskDirty: (value: boolean) => void;
}) => {
  const {
    selectedGuildId,
    contextData,
    askDirty,
    setAskMembersEnabled,
    setAskSharingPolicy,
    setAskDirty,
  } = options;
  if (!selectedGuildId) {
    resetAskSettings({
      setAskMembersEnabled,
      setAskSharingPolicy,
      setAskDirty,
    });
    return;
  }
  if (!contextData || askDirty) return;
  applyAskSettings({
    contextData,
    setAskMembersEnabled,
    setAskSharingPolicy,
  });
};

export default function Settings() {
  const { selectedGuildId, loading: guildLoading } = useGuildContext();
  const trpcUtils = trpc.useUtils();
  const rulesQuery = trpc.autorecord.list.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const channelsQuery = trpc.servers.channels.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const contextQuery = trpc.context.get.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const configQuery = trpc.config.server.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const channelContextsQuery = trpc.channelContexts.list.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );

  const addRuleMutation = trpc.autorecord.add.useMutation();
  const removeRuleMutation = trpc.autorecord.remove.useMutation();
  const saveContextMutation = trpc.context.set.useMutation();
  const setServerConfigMutation = trpc.config.setServerOverride.useMutation();
  const setChannelContextMutation = trpc.channelContexts.set.useMutation();
  const clearChannelContextMutation = trpc.channelContexts.clear.useMutation();

  const [serverContext, setServerContext] = useState("");
  const [defaultNotesChannelId, setDefaultNotesChannelId] = useState<
    string | null
  >(null);
  const [defaultTags, setDefaultTags] = useState("");
  const [globalLiveVoiceEnabled, setGlobalLiveVoiceEnabled] = useState(false);
  const [globalLiveVoiceCommandsEnabled, setGlobalLiveVoiceCommandsEnabled] =
    useState(false);
  const [globalLiveVoiceTtsVoice, setGlobalLiveVoiceTtsVoice] = useState<
    string | null
  >(null);
  const [globalChatTtsEnabled, setGlobalChatTtsEnabled] = useState(false);
  const [globalChatTtsVoice, setGlobalChatTtsVoice] = useState<string | null>(
    null,
  );
  const [recordAllEnabled, setRecordAllEnabled] = useState(false);
  const [globalDirty, setGlobalDirty] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [askMembersEnabled, setAskMembersEnabled] = useState(true);
  const [askSharingPolicy, setAskSharingPolicy] =
    useState<AskSharingPolicy>("server");
  const [askDirty, setAskDirty] = useState(false);
  const [savingAsk, setSavingAsk] = useState(false);
  const [experimentalEnabled, setExperimentalEnabled] = useState(false);
  const [premiumTranscriptionEnabled, setPremiumTranscriptionEnabled] =
    useState(false);
  const [premiumCleanupEnabled, setPremiumCleanupEnabled] = useState(true);
  const [premiumCoalesceModel, setPremiumCoalesceModel] =
    useState("gpt-5-mini");
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const [channelModalOpen, channelModal] = useDisclosure(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [channelVoiceChannelId, setChannelVoiceChannelId] = useState<
    string | null
  >(null);
  const [channelAutoRecord, setChannelAutoRecord] = useState(true);
  const [channelTextChannelId, setChannelTextChannelId] = useState<
    string | null
  >(null);
  const [channelTags, setChannelTags] = useState("");
  const [channelContext, setChannelContext] = useState("");
  const [channelLiveVoiceMode, setChannelLiveVoiceMode] = useState<
    "inherit" | "on" | "off"
  >("inherit");
  const [channelLiveVoiceCommandsMode, setChannelLiveVoiceCommandsMode] =
    useState<"inherit" | "on" | "off">("inherit");
  const [channelChatTtsMode, setChannelChatTtsMode] = useState<
    "inherit" | "on" | "off"
  >("inherit");

  useEffect(() => {
    setGlobalDirty(false);
    setAskDirty(false);
    setAskMembersEnabled(true);
    setAskSharingPolicy("server");
    setExperimentalEnabled(false);
    setPremiumTranscriptionEnabled(false);
    setPremiumCleanupEnabled(true);
    setPremiumCoalesceModel("gpt-5-mini");
    setConfigDirty(false);
    setConfigSaving(false);
    setEditingChannelId(null);
    setChannelVoiceChannelId(null);
    setChannelAutoRecord(true);
    setChannelTextChannelId(null);
    setChannelTags("");
    setChannelContext("");
    setChannelLiveVoiceMode("inherit");
    setChannelLiveVoiceCommandsMode("inherit");
    setChannelChatTtsMode("inherit");
    channelModal.close();
  }, [selectedGuildId]);

  useEffect(() => {
    if (!channelModalOpen || editingChannelId) return;
    if (channelTags) return;
    setChannelTags("");
  }, [channelModalOpen, editingChannelId, channelTags]);

  const autoRecordRules = rulesQuery.data?.rules ?? [];
  const recordAllRule = autoRecordRules.find((rule) => rule.recordAll) ?? null;
  const channelRules = autoRecordRules.filter((rule) => !rule.recordAll);
  const channelContexts = channelContextsQuery.data?.contexts ?? [];

  const voiceChannels = useMemo<ChannelOption[]>(
    () =>
      (channelsQuery.data?.voiceChannels ?? []).map((channel) => ({
        value: channel.id,
        label: channel.name,
        botAccess: channel.botAccess,
        missingPermissions: channel.missingPermissions ?? [],
      })),
    [channelsQuery.data],
  );
  const textChannels = useMemo<ChannelOption[]>(
    () =>
      (channelsQuery.data?.textChannels ?? []).map((channel) => ({
        value: channel.id,
        label: channel.name.startsWith("#") ? channel.name : `#${channel.name}`,
        botAccess: channel.botAccess,
        missingPermissions: channel.missingPermissions ?? [],
      })),
    [channelsQuery.data],
  );

  const voiceChannelMap = useMemo(
    () =>
      new Map(voiceChannels.map((channel) => [channel.value, channel.label])),
    [voiceChannels],
  );
  const textChannelMap = useMemo(
    () =>
      new Map(textChannels.map((channel) => [channel.value, channel.label])),
    [textChannels],
  );
  const voiceChannelAccess = useMemo(
    () => new Map(voiceChannels.map((channel) => [channel.value, channel])),
    [voiceChannels],
  );
  const textChannelAccess = useMemo(
    () => new Map(textChannels.map((channel) => [channel.value, channel])),
    [textChannels],
  );

  const overrides = useMemo(
    () =>
      buildChannelOverrides({
        channelRules,
        channelContexts,
        voiceChannelMap,
        textChannelMap,
        defaultNotesChannelId,
      }),
    [
      channelRules,
      channelContexts,
      voiceChannelMap,
      textChannelMap,
      defaultNotesChannelId,
    ],
  );

  const usedChannelIds = useMemo(
    () => new Set(overrides.map((override) => override.channelId)),
    [overrides],
  );
  const availableVoiceChannels = useMemo(
    () => voiceChannels.filter((channel) => !usedChannelIds.has(channel.value)),
    [voiceChannels, usedChannelIds],
  );
  const channelsRefreshing = channelsQuery.isFetching;

  const channelBusy =
    rulesQuery.isLoading ||
    channelsQuery.isLoading ||
    channelContextsQuery.isLoading ||
    addRuleMutation.isPending ||
    removeRuleMutation.isPending ||
    setChannelContextMutation.isPending ||
    clearChannelContextMutation.isPending;
  const globalBusy =
    rulesQuery.isLoading ||
    channelsQuery.isLoading ||
    contextQuery.isLoading ||
    savingGlobal;
  const askBusy = contextQuery.isLoading || savingAsk;
  const configBusy = configQuery.isLoading || configSaving;

  useEffect(() => {
    syncGlobalDefaults({
      selectedGuildId,
      contextData: contextQuery.data,
      recordAllRule,
      globalDirty,
      setServerContext,
      setDefaultTags,
      setDefaultNotesChannelId,
      setGlobalLiveVoiceEnabled,
      setGlobalLiveVoiceCommandsEnabled,
      setGlobalLiveVoiceTtsVoice,
      setGlobalChatTtsEnabled,
      setGlobalChatTtsVoice,
      setRecordAllEnabled,
      setGlobalDirty,
    });
  }, [contextQuery.data, recordAllRule, selectedGuildId, globalDirty]);

  useEffect(() => {
    syncAskSettings({
      selectedGuildId,
      contextData: contextQuery.data,
      askDirty,
      setAskMembersEnabled,
      setAskSharingPolicy,
      setAskDirty,
    });
  }, [contextQuery.data, selectedGuildId, askDirty]);

  useEffect(() => {
    if (!selectedGuildId) {
      setConfigDirty(false);
      return;
    }
    if (!configQuery.data || configDirty) return;
    const snapshot = configQuery.data.snapshot;
    const values =
      (snapshot?.values as Record<
        string,
        { value?: unknown; gated?: boolean }
      >) ?? {};
    const experimental = values["features.experimental"]?.value ?? false;
    const premiumEnabled =
      values["transcription.premium.enabled"]?.value ?? false;
    const premiumCleanup =
      values["transcription.premium.cleanup.enabled"]?.value ?? true;
    const coalesceModel =
      values["transcription.premium.coalesce.model"]?.value ?? "gpt-5-mini";

    setExperimentalEnabled(Boolean(experimental));
    setPremiumTranscriptionEnabled(Boolean(premiumEnabled));
    setPremiumCleanupEnabled(Boolean(premiumCleanup));
    setPremiumCoalesceModel(String(coalesceModel));
    setConfigDirty(false);
  }, [configQuery.data, selectedGuildId, configDirty]);

  const recordAllRequiresNotesChannel =
    recordAllEnabled && !defaultNotesChannelId;
  const defaultNotesAccess = defaultNotesChannelId
    ? textChannelAccess.get(defaultNotesChannelId)
    : undefined;
  const defaultNotesLabel = defaultNotesAccess
    ? formatChannelLabel(defaultNotesAccess)
    : undefined;
  const defaultNotesMissingPermissions =
    defaultNotesAccess && !defaultNotesAccess.botAccess
      ? defaultNotesAccess.missingPermissions
      : [];

  const canSaveGlobal =
    Boolean(selectedGuildId) &&
    !recordAllRequiresNotesChannel &&
    (!recordAllEnabled || defaultNotesMissingPermissions.length === 0);
  const canSaveAsk = Boolean(selectedGuildId);
  const canSaveConfig = Boolean(selectedGuildId);
  const configTier = configQuery.data?.snapshot?.tier ?? "free";
  const premiumTierLocked = configTier !== "pro";
  const premiumRequiresExperimental = !experimentalEnabled;
  const premiumControlsDisabled =
    configBusy || premiumTierLocked || premiumRequiresExperimental;

  const openAddChannel = () => {
    setEditingChannelId(null);
    setChannelVoiceChannelId(null);
    setChannelAutoRecord(true);
    setChannelTextChannelId(null);
    setChannelTags("");
    setChannelContext("");
    setChannelLiveVoiceMode("inherit");
    setChannelLiveVoiceCommandsMode("inherit");
    setChannelChatTtsMode("inherit");
    channelModal.open();
  };

  const openEditChannel = (override: ChannelOverride) => {
    setEditingChannelId(override.channelId);
    setChannelVoiceChannelId(override.channelId);
    setChannelAutoRecord(override.autoRecordEnabled);
    setChannelTextChannelId(override.textChannelId ?? null);
    setChannelTags(override.tags?.join(", ") ?? "");
    setChannelContext(override.context ?? "");
    setChannelLiveVoiceMode(
      override.liveVoiceEnabled === undefined
        ? "inherit"
        : override.liveVoiceEnabled
          ? "on"
          : "off",
    );
    setChannelLiveVoiceCommandsMode(
      override.liveVoiceCommandsEnabled === undefined
        ? "inherit"
        : override.liveVoiceCommandsEnabled
          ? "on"
          : "off",
    );
    setChannelChatTtsMode(
      override.chatTtsEnabled === undefined
        ? "inherit"
        : override.chatTtsEnabled
          ? "on"
          : "off",
    );
    channelModal.open();
  };

  const closeChannelModal = () => {
    channelModal.close();
  };

  const selectedVoiceChannel = channelVoiceChannelId
    ? voiceChannelAccess.get(channelVoiceChannelId)
    : undefined;
  const resolvedTextChannelId = channelAutoRecord
    ? (channelTextChannelId ?? defaultNotesChannelId ?? null)
    : null;
  const selectedTextChannel = resolvedTextChannelId
    ? textChannelAccess.get(resolvedTextChannelId)
    : undefined;
  const voiceMissingPermissions =
    selectedVoiceChannel && !selectedVoiceChannel.botAccess
      ? selectedVoiceChannel.missingPermissions
      : [];
  const textMissingPermissions =
    selectedTextChannel && !selectedTextChannel.botAccess
      ? selectedTextChannel.missingPermissions
      : [];

  const channelSaveDisabled =
    !selectedGuildId ||
    !channelVoiceChannelId ||
    voiceMissingPermissions.length > 0 ||
    (channelAutoRecord &&
      (!resolvedTextChannelId || textMissingPermissions.length > 0));

  const handleSaveGlobal = async () => {
    if (!selectedGuildId) return;
    if (recordAllRequiresNotesChannel) return;
    const parsedDefaultTags = parseTags(defaultTags) ?? [];
    const trimmedContext = serverContext.trim();
    try {
      setSavingGlobal(true);
      await saveContextMutation.mutateAsync({
        serverId: selectedGuildId,
        context: trimmedContext,
        defaultNotesChannelId: defaultNotesChannelId ?? null,
        defaultTags: parsedDefaultTags,
        liveVoiceEnabled: globalLiveVoiceEnabled,
        liveVoiceCommandsEnabled: globalLiveVoiceCommandsEnabled,
        liveVoiceTtsVoice: globalLiveVoiceTtsVoice,
        chatTtsEnabled: globalChatTtsEnabled,
        chatTtsVoice: globalChatTtsVoice,
      });
      if (recordAllEnabled) {
        if (!defaultNotesChannelId) return;
        await addRuleMutation.mutateAsync({
          serverId: selectedGuildId,
          mode: "all",
          textChannelId: defaultNotesChannelId,
          tags: parsedDefaultTags,
        });
      } else if (recordAllRule) {
        await removeRuleMutation.mutateAsync({
          serverId: selectedGuildId,
          channelId: "ALL",
        });
      }
      await Promise.all([
        trpcUtils.context.get.invalidate({ serverId: selectedGuildId }),
        trpcUtils.autorecord.list.invalidate({ serverId: selectedGuildId }),
      ]);
      setGlobalDirty(false);
    } catch (error) {
      console.error("Failed to save global settings", error);
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveAsk = async () => {
    if (!selectedGuildId) return;
    try {
      setSavingAsk(true);
      await saveContextMutation.mutateAsync({
        serverId: selectedGuildId,
        askMembersEnabled,
        askSharingPolicy,
      });
      await trpcUtils.context.get.invalidate({ serverId: selectedGuildId });
      setAskDirty(false);
    } catch (error) {
      console.error("Failed to save Ask settings", error);
    } finally {
      setSavingAsk(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedGuildId) return;
    try {
      setConfigSaving(true);
      await Promise.all([
        setServerConfigMutation.mutateAsync({
          serverId: selectedGuildId,
          key: "features.experimental",
          value: experimentalEnabled,
        }),
        setServerConfigMutation.mutateAsync({
          serverId: selectedGuildId,
          key: "transcription.premium.enabled",
          value: premiumTranscriptionEnabled,
        }),
        setServerConfigMutation.mutateAsync({
          serverId: selectedGuildId,
          key: "transcription.premium.cleanup.enabled",
          value: premiumCleanupEnabled,
        }),
        setServerConfigMutation.mutateAsync({
          serverId: selectedGuildId,
          key: "transcription.premium.coalesce.model",
          value: premiumCoalesceModel,
        }),
      ]);
      await trpcUtils.config.server.invalidate({ serverId: selectedGuildId });
      setConfigDirty(false);
    } catch (error) {
      console.error("Failed to save config settings", error);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSaveChannel = async () => {
    if (!selectedGuildId || !channelVoiceChannelId) return;
    if (channelSaveDisabled) return;
    const existingOverride = overrides.find(
      (override) => override.channelId === channelVoiceChannelId,
    );
    const trimmedContext = channelContext.trim();
    const tasks: Promise<unknown>[] = [];
    const liveVoiceOverride =
      channelLiveVoiceMode === "inherit" ? null : channelLiveVoiceMode === "on";
    const liveVoiceCommandsOverride =
      channelLiveVoiceCommandsMode === "inherit"
        ? null
        : channelLiveVoiceCommandsMode === "on";
    const chatTtsOverride =
      channelChatTtsMode === "inherit" ? null : channelChatTtsMode === "on";
    const shouldUpdateContext =
      trimmedContext.length > 0 ||
      existingOverride?.context ||
      liveVoiceOverride !== null ||
      existingOverride?.liveVoiceEnabled !== undefined ||
      liveVoiceCommandsOverride !== null ||
      existingOverride?.liveVoiceCommandsEnabled !== undefined ||
      chatTtsOverride !== null ||
      existingOverride?.chatTtsEnabled !== undefined;
    if (shouldUpdateContext) {
      tasks.push(
        setChannelContextMutation.mutateAsync({
          serverId: selectedGuildId,
          channelId: channelVoiceChannelId,
          context: trimmedContext.length > 0 ? trimmedContext : undefined,
          liveVoiceEnabled: liveVoiceOverride,
          liveVoiceCommandsEnabled: liveVoiceCommandsOverride,
          chatTtsEnabled: chatTtsOverride,
        }),
      );
    }

    if (channelAutoRecord) {
      tasks.push(
        addRuleMutation.mutateAsync({
          serverId: selectedGuildId,
          mode: "one",
          voiceChannelId: channelVoiceChannelId,
          textChannelId: channelTextChannelId ?? null,
          tags: parseTags(channelTags),
        }),
      );
    } else if (existingOverride?.autoRecordEnabled) {
      tasks.push(
        removeRuleMutation.mutateAsync({
          serverId: selectedGuildId,
          channelId: channelVoiceChannelId,
        }),
      );
    }

    try {
      await Promise.all(tasks);
      await Promise.all([
        trpcUtils.autorecord.list.invalidate({ serverId: selectedGuildId }),
        trpcUtils.channelContexts.list.invalidate({
          serverId: selectedGuildId,
        }),
      ]);
      closeChannelModal();
    } catch (error) {
      console.error("Failed to save channel settings", error);
    }
  };

  const handleRemoveOverride = async (override: ChannelOverride) => {
    if (!selectedGuildId) return;
    const tasks: Promise<unknown>[] = [];
    if (override.autoRecordEnabled) {
      tasks.push(
        removeRuleMutation.mutateAsync({
          serverId: selectedGuildId,
          channelId: override.channelId,
        }),
      );
    }
    if (
      override.context ||
      override.liveVoiceEnabled !== undefined ||
      override.liveVoiceCommandsEnabled !== undefined ||
      override.chatTtsEnabled !== undefined
    ) {
      tasks.push(
        clearChannelContextMutation.mutateAsync({
          serverId: selectedGuildId,
          channelId: override.channelId,
        }),
      );
    }
    try {
      await Promise.all(tasks);
      await Promise.all([
        trpcUtils.autorecord.list.invalidate({ serverId: selectedGuildId }),
        trpcUtils.channelContexts.list.invalidate({
          serverId: selectedGuildId,
        }),
      ]);
    } catch (error) {
      console.error("Failed to remove channel override", error);
    }
  };

  return (
    <Stack gap="xl" data-testid="settings-page">
      <PageHeader
        title="Server settings"
        description="Configure how Chronote records, tags, and summarizes this server."
      />

      <GlobalDefaultsCard
        busy={globalBusy}
        canSave={canSaveGlobal}
        saving={savingGlobal}
        serverContext={serverContext}
        onServerContextChange={(value) => {
          setServerContext(value);
          setGlobalDirty(true);
        }}
        defaultNotesChannelId={defaultNotesChannelId}
        onDefaultNotesChannelChange={(value) => {
          setDefaultNotesChannelId(value);
          setGlobalDirty(true);
        }}
        defaultTags={defaultTags}
        onDefaultTagsChange={(value) => {
          setDefaultTags(value);
          setGlobalDirty(true);
        }}
        textChannels={textChannels}
        defaultNotesAccess={defaultNotesAccess}
        globalLiveVoiceEnabled={globalLiveVoiceEnabled}
        onGlobalLiveVoiceEnabledChange={(value) => {
          setGlobalLiveVoiceEnabled(value);
          setGlobalDirty(true);
        }}
        globalLiveVoiceCommandsEnabled={globalLiveVoiceCommandsEnabled}
        onGlobalLiveVoiceCommandsEnabledChange={(value) => {
          setGlobalLiveVoiceCommandsEnabled(value);
          setGlobalDirty(true);
        }}
        globalLiveVoiceTtsVoice={globalLiveVoiceTtsVoice}
        onGlobalLiveVoiceTtsVoiceChange={(value) => {
          setGlobalLiveVoiceTtsVoice(value);
          setGlobalDirty(true);
        }}
        globalChatTtsEnabled={globalChatTtsEnabled}
        onGlobalChatTtsEnabledChange={(value) => {
          setGlobalChatTtsEnabled(value);
          setGlobalDirty(true);
        }}
        globalChatTtsVoice={globalChatTtsVoice}
        onGlobalChatTtsVoiceChange={(value) => {
          setGlobalChatTtsVoice(value);
          setGlobalDirty(true);
        }}
        recordAllEnabled={recordAllEnabled}
        onRecordAllEnabledChange={(value) => {
          setRecordAllEnabled(value);
          setGlobalDirty(true);
        }}
        onSave={handleSaveGlobal}
      />

      <Surface p="lg" style={{ position: "relative", overflow: "hidden" }}>
        <AskSharingCard
          askMembersEnabled={askMembersEnabled}
          askSharingPolicy={askSharingPolicy}
          askBusy={askBusy}
          canSaveAsk={canSaveAsk}
          savingAsk={savingAsk}
          onMembersChange={(value) => {
            setAskMembersEnabled(value);
            setAskDirty(true);
          }}
          onPolicyChange={(value) => {
            setAskSharingPolicy(value);
            setAskDirty(true);
          }}
          onSave={handleSaveAsk}
        />
      </Surface>

      <Surface p="lg" style={{ position: "relative", overflow: "hidden" }}>
        <LoadingOverlay
          visible={configBusy}
          overlayProps={uiOverlays.loading}
          loaderProps={{ size: "md" }}
        />
        <Stack gap="md">
          <Text fw={600}>Experimental and premium features</Text>
          <Switch
            label="Enable experimental features for this server"
            checked={experimentalEnabled}
            onChange={(event) => {
              setExperimentalEnabled(event.currentTarget.checked);
              setConfigDirty(true);
            }}
            disabled={configBusy}
          />
          <Switch
            label="Premium transcription (pro only)"
            checked={premiumTranscriptionEnabled}
            onChange={(event) => {
              setPremiumTranscriptionEnabled(event.currentTarget.checked);
              setConfigDirty(true);
            }}
            disabled={premiumControlsDisabled}
          />
          {premiumTierLocked ? (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
            >
              Premium transcription requires a pro plan. Upgrade in Billing to
              enable it.
            </Alert>
          ) : null}
          {premiumRequiresExperimental ? (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
            >
              Turn on experimental features to enable premium transcription.
            </Alert>
          ) : null}
          <FormSelect
            label="Premium coalesce model"
            data={["gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"]}
            value={premiumCoalesceModel}
            onChange={(value) => {
              if (!value) return;
              setPremiumCoalesceModel(value);
              setConfigDirty(true);
            }}
            disabled={premiumControlsDisabled}
          />
          <Switch
            label="Enable premium transcription cleanup"
            checked={premiumCleanupEnabled}
            onChange={(event) => {
              setPremiumCleanupEnabled(event.currentTarget.checked);
              setConfigDirty(true);
            }}
            disabled={premiumControlsDisabled}
          />
          <Group justify="flex-end">
            <Button
              onClick={handleSaveConfig}
              disabled={!canSaveConfig || configBusy}
              loading={configSaving}
            >
              Save experimental settings
            </Button>
          </Group>
        </Stack>
      </Surface>

      <ChannelOverridesCard
        busy={channelBusy}
        refreshing={channelsRefreshing}
        overrides={overrides}
        availableVoiceChannels={availableVoiceChannels}
        onRefresh={() => channelsQuery.refetch()}
        onAdd={openAddChannel}
        onSelect={(id) => {
          const found = overrides.find((o) => o.channelId === id);
          if (found) openEditChannel(found);
        }}
        onRemove={handleRemoveOverride}
      />

      <Modal
        opened={channelModalOpen}
        onClose={closeChannelModal}
        title={
          editingChannelId ? "Edit channel settings" : "Add channel settings"
        }
        overlayProps={uiOverlays.modal}
        data-testid="settings-channel-modal"
      >
        <Stack gap="sm">
          {editingChannelId ? (
            <Stack gap={6}>
              <Text size="sm" fw={600}>
                Voice channel
              </Text>
              <Text fw={600}>
                {channelVoiceChannelId
                  ? (voiceChannelMap.get(channelVoiceChannelId) ??
                    "Unknown channel")
                  : "Unknown channel"}
              </Text>
              <Text size="xs" c="dimmed">
                Channel is fixed for this override.
              </Text>
            </Stack>
          ) : (
            <FormSelect
              label="Voice channel"
              placeholder={
                channelsQuery.isLoading ? "Loading..." : "Select voice channel"
              }
              data={availableVoiceChannels.map((channel) => ({
                value: channel.value,
                label: formatChannelLabel(channel),
              }))}
              value={channelVoiceChannelId}
              onChange={setChannelVoiceChannelId}
            />
          )}
          {voiceMissingPermissions.length > 0 ? (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="red"
              variant="light"
            >
              Bot needs access to join this channel (
              {voiceMissingPermissions.join(", ")}). Update channel permissions
              then refresh.
            </Alert>
          ) : null}
          <Switch
            label="Auto-record this channel"
            checked={channelAutoRecord}
            onChange={(event) =>
              setChannelAutoRecord(event.currentTarget.checked)
            }
          />
          {recordAllEnabled && !channelAutoRecord ? (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
            >
              Record-all is enabled. Disabling auto-record here will still fall
              back to the global setting.
            </Alert>
          ) : null}
          {channelAutoRecord ? (
            <FormSelect
              label="Notes channel"
              placeholder={
                channelsQuery.isLoading ? "Loading..." : "Select channel"
              }
              data={[
                ...(defaultNotesChannelId
                  ? [
                      {
                        value: "__default",
                        label: `Use default (${defaultNotesLabel ?? "Default notes channel"})`,
                      },
                    ]
                  : []),
                ...textChannels.map((channel) => ({
                  value: channel.value,
                  label: formatChannelLabel(channel),
                })),
              ]}
              value={
                channelTextChannelId ??
                (defaultNotesChannelId ? "__default" : null)
              }
              onChange={(value) => {
                if (value === "__default") {
                  setChannelTextChannelId(null);
                } else {
                  setChannelTextChannelId(value);
                }
              }}
            />
          ) : null}
          {channelAutoRecord && !resolvedTextChannelId ? (
            <Text size="sm" c="red">
              Select a notes channel or set a default notes channel first.
            </Text>
          ) : null}
          {channelAutoRecord && textMissingPermissions.length > 0 ? (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="red"
              variant="light"
            >
              Bot needs access to post notes (
              {textMissingPermissions.join(", ")}).
            </Alert>
          ) : null}
          {channelAutoRecord ? (
            <TextInput
              label="Tags"
              placeholder="campaign, recap"
              value={channelTags}
              onChange={(event) => setChannelTags(event.currentTarget.value)}
            />
          ) : null}
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Live voice responder
            </Text>
            <SegmentedControl
              value={channelLiveVoiceMode}
              onChange={(value) =>
                setChannelLiveVoiceMode(value as "inherit" | "on" | "off")
              }
              data={[
                { label: "Use default", value: "inherit" },
                { label: "On", value: "on" },
                { label: "Off", value: "off" },
              ]}
              fullWidth
            />
            <Text size="xs" c="dimmed">
              Use default to inherit the server-wide setting.
            </Text>
          </Stack>
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Live voice commands
            </Text>
            <SegmentedControl
              value={channelLiveVoiceCommandsMode}
              onChange={(value) =>
                setChannelLiveVoiceCommandsMode(
                  value as "inherit" | "on" | "off",
                )
              }
              data={[
                { label: "Use default", value: "inherit" },
                { label: "On", value: "on" },
                { label: "Off", value: "off" },
              ]}
              fullWidth
            />
            <Text size="xs" c="dimmed">
              Use default to inherit the server-wide setting.
            </Text>
          </Stack>
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Chat-to-speech
            </Text>
            <SegmentedControl
              value={channelChatTtsMode}
              onChange={(value) =>
                setChannelChatTtsMode(value as "inherit" | "on" | "off")
              }
              data={[
                { label: "Use default", value: "inherit" },
                { label: "On", value: "on" },
                { label: "Off", value: "off" },
              ]}
              fullWidth
            />
            <Text size="xs" c="dimmed">
              Use default to inherit the server-wide setting.
            </Text>
          </Stack>
          <Textarea
            label="Channel context"
            minRows={4}
            placeholder="Optional instructions for meetings recorded in this channel"
            value={channelContext}
            onChange={(event) => setChannelContext(event.currentTarget.value)}
          />
          <Group justify="space-between" align="center">
            {voiceMissingPermissions.length > 0 ||
            textMissingPermissions.length > 0 ? (
              <Button
                variant="subtle"
                leftSection={<IconRefresh size={16} />}
                onClick={() => channelsQuery.refetch()}
                loading={channelsRefreshing}
                disabled={channelBusy}
                data-testid="settings-recheck-bot"
              >
                Recheck bot access
              </Button>
            ) : (
              <span />
            )}
            <Group gap="sm">
              <Button variant="default" onClick={closeChannelModal}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveChannel}
                disabled={channelSaveDisabled}
                data-testid="settings-save-channel"
              >
                Save channel
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
