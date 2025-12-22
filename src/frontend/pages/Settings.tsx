import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
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
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconBroadcast,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import FormSelect from "../components/FormSelect";
import { trpc } from "../services/trpc";
import { uiOverlays } from "../uiTokens";
import { parseTags } from "../../utils/tags";
import type { AutoRecordSettings, ChannelContext } from "../../types/db";

type ChannelOption = {
  value: string;
  label: string;
  botAccess: boolean;
  missingPermissions: string[];
};

type ChannelOverride = {
  channelId: string;
  voiceLabel: string;
  textLabel?: string;
  textChannelId?: string;
  tags?: string[];
  context?: string;
  autoRecordEnabled: boolean;
  liveVoiceEnabled?: boolean;
};

const formatChannelLabel = (channel: ChannelOption) =>
  channel.botAccess ? channel.label : `${channel.label} (bot access needed)`;

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
  const channelContextsQuery = trpc.channelContexts.list.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );

  const addRuleMutation = trpc.autorecord.add.useMutation();
  const removeRuleMutation = trpc.autorecord.remove.useMutation();
  const saveContextMutation = trpc.context.set.useMutation();
  const setChannelContextMutation = trpc.channelContexts.set.useMutation();
  const clearChannelContextMutation = trpc.channelContexts.clear.useMutation();

  const [serverContext, setServerContext] = useState("");
  const [defaultNotesChannelId, setDefaultNotesChannelId] = useState<
    string | null
  >(null);
  const [defaultTags, setDefaultTags] = useState("");
  const [globalLiveVoiceEnabled, setGlobalLiveVoiceEnabled] = useState(false);
  const [recordAllEnabled, setRecordAllEnabled] = useState(false);
  const [globalDirty, setGlobalDirty] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);

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

  useEffect(() => {
    setGlobalDirty(false);
    setEditingChannelId(null);
    setChannelVoiceChannelId(null);
    setChannelAutoRecord(true);
    setChannelTextChannelId(null);
    setChannelTags("");
    setChannelContext("");
    setChannelLiveVoiceMode("inherit");
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

  const overrides = useMemo<ChannelOverride[]>(() => {
    const merged = new Map<
      string,
      { rule?: AutoRecordSettings; context?: ChannelContext }
    >();
    channelRules.forEach((rule) => {
      merged.set(rule.channelId, { rule });
    });
    channelContexts.forEach((context) => {
      const existing = merged.get(context.channelId) ?? {};
      merged.set(context.channelId, { ...existing, context });
    });
    return Array.from(merged.entries())
      .map(([channelId, entry]) => {
        const voiceLabel = voiceChannelMap.get(channelId) ?? "Unknown channel";
        const resolvedTextChannelId =
          entry.rule?.textChannelId ?? defaultNotesChannelId ?? undefined;
        const textLabel = entry.rule
          ? (textChannelMap.get(resolvedTextChannelId ?? "") ??
            (defaultNotesChannelId
              ? "Default notes channel"
              : "Unknown channel"))
          : undefined;
        return {
          channelId,
          voiceLabel,
          textLabel,
          textChannelId: entry.rule?.textChannelId,
          tags: entry.rule?.tags,
          context: entry.context?.context,
          autoRecordEnabled: Boolean(entry.rule?.enabled),
          liveVoiceEnabled: entry.context?.liveVoiceEnabled,
        };
      })
      .sort((a, b) => a.voiceLabel.localeCompare(b.voiceLabel));
  }, [
    channelRules,
    channelContexts,
    voiceChannelMap,
    textChannelMap,
    defaultNotesChannelId,
  ]);

  const usedChannelIds = useMemo(
    () => new Set(overrides.map((override) => override.channelId)),
    [overrides],
  );
  const availableVoiceChannels = useMemo(
    () => voiceChannels.filter((channel) => !usedChannelIds.has(channel.value)),
    [voiceChannels, usedChannelIds],
  );

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

  useEffect(() => {
    if (!selectedGuildId) {
      setServerContext("");
      setDefaultNotesChannelId(null);
      setDefaultTags("");
      setGlobalLiveVoiceEnabled(false);
      setRecordAllEnabled(false);
      setGlobalDirty(false);
      return;
    }
    if (!contextQuery.data || globalDirty) return;
    setServerContext(contextQuery.data.context ?? "");
    setDefaultTags((contextQuery.data.defaultTags ?? []).join(", "));
    setDefaultNotesChannelId(
      contextQuery.data.defaultNotesChannelId ??
        recordAllRule?.textChannelId ??
        null,
    );
    setGlobalLiveVoiceEnabled(contextQuery.data.liveVoiceEnabled ?? false);
    setRecordAllEnabled(Boolean(recordAllRule));
  }, [contextQuery.data, recordAllRule, selectedGuildId, globalDirty]);

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

  const openAddChannel = () => {
    setEditingChannelId(null);
    setChannelVoiceChannelId(null);
    setChannelAutoRecord(true);
    setChannelTextChannelId(null);
    setChannelTags("");
    setChannelContext("");
    setChannelLiveVoiceMode("inherit");
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
    const shouldUpdateContext =
      trimmedContext.length > 0 ||
      existingOverride?.context ||
      liveVoiceOverride !== null ||
      existingOverride?.liveVoiceEnabled !== undefined;
    if (shouldUpdateContext) {
      tasks.push(
        setChannelContextMutation.mutateAsync({
          serverId: selectedGuildId,
          channelId: channelVoiceChannelId,
          context: trimmedContext.length > 0 ? trimmedContext : undefined,
          liveVoiceEnabled: liveVoiceOverride,
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
    if (override.context || override.liveVoiceEnabled !== undefined) {
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
    <Stack gap="xl">
      <PageHeader
        title="Server settings"
        description="Configure how Chronote records, tags, and summarizes this server."
      />

      <Surface p="lg" style={{ position: "relative", overflow: "hidden" }}>
        <LoadingOverlay
          visible={globalBusy}
          overlayProps={uiOverlays.loading}
          loaderProps={{ size: "md" }}
        />
        <Stack gap="md">
          <Group gap="sm">
            <ThemeIcon variant="light" color="brand">
              <IconSettings size={18} />
            </ThemeIcon>
            <Text fw={600}>Global defaults</Text>
          </Group>
          <Text size="sm" c="dimmed">
            Defaults apply to all channels unless you override them below.
          </Text>
          <Switch
            label="Record all voice channels by default"
            checked={recordAllEnabled}
            onChange={(event) => {
              setRecordAllEnabled(event.currentTarget.checked);
              setGlobalDirty(true);
            }}
            disabled={globalBusy}
          />
          <Switch
            label="Enable live voice responder by default"
            checked={globalLiveVoiceEnabled}
            onChange={(event) => {
              setGlobalLiveVoiceEnabled(event.currentTarget.checked);
              setGlobalDirty(true);
            }}
            disabled={globalBusy}
          />
          {recordAllEnabled ? (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
            >
              Recording all channels uses the default notes channel below. You
              can still override settings per channel.
            </Alert>
          ) : null}
          <FormSelect
            label="Default notes channel"
            placeholder={
              channelsQuery.isLoading ? "Loading..." : "Select channel"
            }
            data={textChannels.map((channel) => ({
              value: channel.value,
              label: formatChannelLabel(channel),
            }))}
            value={defaultNotesChannelId}
            onChange={(value) => {
              setDefaultNotesChannelId(value);
              setGlobalDirty(true);
            }}
            disabled={globalBusy}
          />
          {recordAllRequiresNotesChannel ? (
            <Text size="sm" c="red">
              Default notes channel is required when record all is enabled.
            </Text>
          ) : null}
          {defaultNotesMissingPermissions.length > 0 ? (
            <Text size="sm" c="red">
              Bot needs access to send messages (
              {defaultNotesMissingPermissions.join(", ")}).
            </Text>
          ) : null}
          <TextInput
            label="Default tags"
            placeholder="campaign, recap"
            value={defaultTags}
            onChange={(event) => {
              setDefaultTags(event.currentTarget.value);
              setGlobalDirty(true);
            }}
            disabled={globalBusy}
          />
          <Textarea
            label="Server context"
            minRows={4}
            value={serverContext}
            onChange={(event) => {
              setServerContext(event.currentTarget.value);
              setGlobalDirty(true);
            }}
            disabled={globalBusy}
          />
          <Group justify="flex-end">
            <Button
              variant="light"
              onClick={handleSaveGlobal}
              disabled={!canSaveGlobal || globalBusy}
              loading={savingGlobal}
            >
              Save defaults
            </Button>
          </Group>
        </Stack>
      </Surface>

      <Surface p="lg" style={{ position: "relative", overflow: "hidden" }}>
        <LoadingOverlay
          visible={channelBusy}
          overlayProps={uiOverlays.loading}
          loaderProps={{ size: "md" }}
        />
        <Stack gap="md">
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Group gap="sm">
              <ThemeIcon variant="light" color="brand">
                <IconBroadcast size={18} />
              </ThemeIcon>
              <Text fw={600}>Channel overrides</Text>
            </Group>
            <Group gap="sm">
              <Button
                variant="subtle"
                leftSection={<IconRefresh size={16} />}
                onClick={() => channelsQuery.refetch()}
              >
                Refresh channels
              </Button>
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={openAddChannel}
                disabled={availableVoiceChannels.length === 0}
              >
                Add channel
              </Button>
            </Group>
          </Group>
          <Text size="sm" c="dimmed">
            Add custom settings for specific voice channels. Channel context is
            always applied when the meeting runs.
          </Text>

          {overrides.length === 0 ? (
            <Text size="sm" c="dimmed">
              No overrides yet. Add a voice channel to customize its notes,
              tags, and context.
            </Text>
          ) : (
            <Stack gap="sm">
              {overrides.map((override) => {
                const access = voiceChannelAccess.get(override.channelId);
                const voiceMissing =
                  access && !access.botAccess ? access.missingPermissions : [];
                const resolvedNotesLabel =
                  override.textLabel ??
                  (defaultNotesChannelId
                    ? textChannelMap.get(defaultNotesChannelId)
                    : "Default notes channel");
                const detailLines: ReactNode[] = [];
                if (override.autoRecordEnabled) {
                  const summary = override.tags?.length
                    ? `Auto-recorded ? ${resolvedNotesLabel ?? "Default notes channel"} � Tags: ${override.tags.join(", ")}`
                    : `Auto-recorded ? ${resolvedNotesLabel ?? "Default notes channel"}`;
                  detailLines.push(
                    <Text size="sm" c="dimmed" key="auto">
                      {summary}
                    </Text>,
                  );
                } else if (recordAllEnabled) {
                  detailLines.push(
                    <Text size="sm" c="dimmed" key="auto-off">
                      Auto-record disabled for this channel.
                    </Text>,
                  );
                }
                if (override.liveVoiceEnabled !== undefined) {
                  detailLines.push(
                    <Text size="sm" c="dimmed" key="live-voice">
                      Live voice responder:{" "}
                      {override.liveVoiceEnabled ? "On" : "Off"}
                    </Text>,
                  );
                }
                return (
                  <Surface key={override.channelId} p="md" tone="soft">
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={600}>{override.voiceLabel}</Text>
                        {detailLines.map((line) => line)}
                        {override.context ? (
                          <Text size="sm" c="dimmed" lineClamp={2}>
                            Context: {override.context}
                          </Text>
                        ) : null}
                        {voiceMissing.length > 0 ? (
                          <Text size="sm" c="red">
                            Bot needs access: {voiceMissing.join(", ")}
                          </Text>
                        ) : null}
                      </Stack>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconEdit size={14} />}
                          onClick={() => openEditChannel(override)}
                        >
                          Edit
                        </Button>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => handleRemoveOverride(override)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Surface>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Surface>

      <Modal
        opened={channelModalOpen}
        onClose={closeChannelModal}
        title={
          editingChannelId ? "Edit channel settings" : "Add channel settings"
        }
        overlayProps={uiOverlays.modal}
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
