import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Divider,
  Group,
  LoadingOverlay,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconBroadcast,
  IconSettings,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import FormSelect from "../components/FormSelect";
import { trpc } from "../services/trpc";

type ChannelOption = { value: string; label: string };

export default function Settings() {
  const { selectedGuildId, loading: guildLoading } = useGuildContext();
  const [autoRecordMode, setAutoRecordMode] = useState<"one" | "all">("one");
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [textChannelId, setTextChannelId] = useState<string | null>(null);
  const trpcUtils = trpc.useUtils();
  const rulesQuery = trpc.autorecord.list.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const channelsQuery = trpc.servers.channels.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const addRuleMutation = trpc.autorecord.add.useMutation();
  const removeRuleMutation = trpc.autorecord.remove.useMutation();
  const contextQuery = trpc.context.get.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) && !guildLoading },
  );
  const saveContextMutation = trpc.context.set.useMutation();
  const clearContextMutation = trpc.context.clear.useMutation();
  const [context, setContext] = useState(
    "Weekly product sync focused on launches, roadmap, and blockers.",
  );
  const [contextDirty, setContextDirty] = useState(false);
  const [tags, setTags] = useState("product, weekly");
  const [retention, setRetention] = useState("30");

  const autoRecordRules = rulesQuery.data?.rules ?? [];
  const voiceChannels = useMemo<ChannelOption[]>(
    () =>
      (channelsQuery.data?.voiceChannels ?? []).map((channel) => ({
        value: channel.id,
        label: channel.name,
      })),
    [channelsQuery.data],
  );
  const textChannels = useMemo<ChannelOption[]>(
    () =>
      (channelsQuery.data?.textChannels ?? []).map((channel) => ({
        value: channel.id,
        label: channel.name.startsWith("#") ? channel.name : `#${channel.name}`,
      })),
    [channelsQuery.data],
  );
  const voiceChannelMap = useMemo(
    () =>
      new Map(voiceChannels.map((channel) => [channel.value, channel.label])),
    [voiceChannels],
  );
  const hasRecordAll = useMemo(
    () => autoRecordRules.some((rule) => rule.recordAll),
    [autoRecordRules],
  );
  const sortedRules = useMemo(
    () =>
      [...autoRecordRules].sort((a, b) => {
        if (a.recordAll !== b.recordAll) {
          return a.recordAll ? -1 : 1;
        }
        return a.channelId.localeCompare(b.channelId);
      }),
    [autoRecordRules],
  );
  const usedVoiceChannelIds = useMemo(
    () =>
      new Set(
        autoRecordRules
          .filter((rule) => !rule.recordAll)
          .map((rule) => rule.channelId),
      ),
    [autoRecordRules],
  );
  const availableVoiceChannels = useMemo(
    () =>
      voiceChannels.filter(
        (channel) => !usedVoiceChannelIds.has(channel.value),
      ),
    [voiceChannels, usedVoiceChannelIds],
  );
  const loadingRules = rulesQuery.isLoading || channelsQuery.isLoading;
  const savingRules = addRuleMutation.isPending || removeRuleMutation.isPending;
  const isAutoRecordBusy = loadingRules || savingRules;
  const contextLoading = contextQuery.isLoading;
  const contextSaving =
    saveContextMutation.isPending || clearContextMutation.isPending;
  const contextDisabled = !selectedGuildId || contextLoading || contextSaving;
  const textChannelMap = useMemo(
    () =>
      new Map(textChannels.map((channel) => [channel.value, channel.label])),
    [textChannels],
  );

  useEffect(() => {
    setAutoRecordMode("one");
    setVoiceChannelId(null);
    setTextChannelId(null);
    setContextDirty(false);
  }, [selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId) {
      setContext("");
      setContextDirty(false);
      return;
    }
    if (contextQuery.data && !contextDirty) {
      setContext(contextQuery.data.context ?? "");
    }
  }, [selectedGuildId, contextQuery.data, contextDirty]);

  const handleAddRule = async () => {
    if (!selectedGuildId || !textChannelId) return;
    if (autoRecordMode === "one" && !voiceChannelId) return;
    try {
      await addRuleMutation.mutateAsync({
        serverId: selectedGuildId,
        mode: autoRecordMode,
        voiceChannelId:
          autoRecordMode === "one" ? (voiceChannelId ?? undefined) : undefined,
        textChannelId,
      });
      await trpcUtils.autorecord.list.invalidate({
        serverId: selectedGuildId,
      });
      setVoiceChannelId(null);
      setTextChannelId(null);
      setAutoRecordMode("one");
    } catch (err) {
      console.error("Failed to add autorecord rule", err);
    }
  };

  const handleRemoveRule = async (channelId: string) => {
    if (!selectedGuildId) return;
    try {
      await removeRuleMutation.mutateAsync({
        serverId: selectedGuildId,
        channelId,
      });
      await trpcUtils.autorecord.list.invalidate({
        serverId: selectedGuildId,
      });
    } catch (err) {
      console.error("Failed to remove autorecord rule", err);
    }
  };

  const handleSaveContext = async () => {
    if (!selectedGuildId) return;
    const trimmed = context.trim();
    if (!trimmed) return;
    try {
      await saveContextMutation.mutateAsync({
        serverId: selectedGuildId,
        context: trimmed,
      });
      setContextDirty(false);
      await trpcUtils.context.get.invalidate({ serverId: selectedGuildId });
    } catch (err) {
      console.error("Failed to save context", err);
    }
  };

  const handleClearContext = async () => {
    if (!selectedGuildId) return;
    try {
      await clearContextMutation.mutateAsync({ serverId: selectedGuildId });
      setContext("");
      setContextDirty(false);
      await trpcUtils.context.get.invalidate({ serverId: selectedGuildId });
    } catch (err) {
      console.error("Failed to clear context", err);
    }
  };

  return (
    <Stack gap="xl">
      <PageHeader
        title="Server settings"
        description="Configure how Chronote records, tags, and summarizes this server."
      />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Surface p="lg" style={{ position: "relative", overflow: "hidden" }}>
          <LoadingOverlay
            visible={isAutoRecordBusy}
            overlayProps={{ blur: 2, radius: "xl" }}
            loaderProps={{ size: "md" }}
          />
          <Stack gap="sm">
            <Group gap="sm">
              <ThemeIcon variant="light" color="brand" radius="md">
                <IconBroadcast size={18} />
              </ThemeIcon>
              <Text fw={600}>Auto recording</Text>
            </Group>
            <Stack gap="xs">
              {autoRecordRules.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No auto-record rules yet. Add one to start capturing voice
                  channels automatically.
                </Text>
              ) : null}
              {sortedRules.map((rule) => {
                const voiceLabel = rule.recordAll
                  ? "All voice channels"
                  : voiceChannelMap.get(rule.channelId) || "Unknown channel";
                const textLabel =
                  textChannelMap.get(rule.textChannelId) || "Unknown channel";
                return (
                  <Surface key={rule.channelId} p="md" tone="soft" radius="md">
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={600}>{voiceLabel}</Text>
                        <Text size="sm" c="dimmed">
                          Notes post to {textLabel}
                        </Text>
                      </Stack>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => handleRemoveRule(rule.channelId)}
                        disabled={isAutoRecordBusy}
                      >
                        Remove
                      </Button>
                    </Group>
                  </Surface>
                );
              })}
            </Stack>
            <Divider />
            <Stack gap="sm">
              <Text fw={600}>Add auto-record rule</Text>
              {hasRecordAll ? (
                <Text size="sm" c="dimmed">
                  All voice channels are already enabled. Remove the "All voice
                  channels" rule above to configure individual channels.
                </Text>
              ) : (
                <>
                  <FormSelect
                    label="Mode"
                    value={autoRecordMode}
                    onChange={(value) =>
                      setAutoRecordMode((value as "one" | "all") || "one")
                    }
                    data={[
                      { value: "one", label: "One voice channel" },
                      { value: "all", label: "All voice channels" },
                    ]}
                    disabled={isAutoRecordBusy}
                  />
                  {autoRecordMode === "one" ? (
                    <FormSelect
                      label="Voice channel"
                      placeholder={
                        loadingRules
                          ? "Loading..."
                          : availableVoiceChannels.length === 0
                            ? "All voice channels already configured"
                            : "Select channel"
                      }
                      data={availableVoiceChannels}
                      value={voiceChannelId}
                      onChange={setVoiceChannelId}
                      disabled={
                        isAutoRecordBusy || availableVoiceChannels.length === 0
                      }
                    />
                  ) : null}
                  <FormSelect
                    label="Text channel"
                    placeholder={loadingRules ? "Loading..." : "Select channel"}
                    data={textChannels}
                    value={textChannelId}
                    onChange={setTextChannelId}
                    disabled={isAutoRecordBusy}
                  />
                  <Group justify="flex-end">
                    <Button
                      variant="light"
                      onClick={handleAddRule}
                      disabled={
                        isAutoRecordBusy ||
                        !selectedGuildId ||
                        !textChannelId ||
                        (autoRecordMode === "one" && !voiceChannelId)
                      }
                      loading={savingRules}
                    >
                      Add rule
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Stack>
        </Surface>

        <Surface p="lg">
          <Stack gap="sm">
            <Group gap="sm">
              <ThemeIcon variant="light" color="brand" radius="md">
                <IconSettings size={18} />
              </ThemeIcon>
              <Text fw={600}>Context and tags</Text>
            </Group>
            <Textarea
              label="Server context"
              minRows={5}
              value={context}
              onChange={(event) => {
                setContext(event.currentTarget.value);
                setContextDirty(true);
              }}
              disabled={contextDisabled}
            />
            <TextInput
              label="Default tags"
              value={tags}
              onChange={(event) => setTags(event.currentTarget.value)}
            />
            <FormSelect
              label="Retention window"
              value={retention}
              onChange={(value) => setRetention(value || "30")}
              data={[
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
                { value: "90", label: "90 days" },
                { value: "365", label: "1 year" },
              ]}
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="gray"
                onClick={handleClearContext}
                disabled={
                  contextDisabled ||
                  context.trim().length === 0 ||
                  contextSaving
                }
              >
                Clear
              </Button>
              <Button
                variant="light"
                onClick={handleSaveContext}
                disabled={
                  contextDisabled ||
                  !contextDirty ||
                  context.trim().length === 0
                }
                loading={saveContextMutation.isPending}
              >
                Save context
              </Button>
            </Group>
          </Stack>
        </Surface>
      </SimpleGrid>

      <Surface p="lg">
        <Stack gap="sm">
          <Group gap="sm">
            <ThemeIcon variant="light" color="brand" radius="md">
              <IconSparkles size={18} />
            </ThemeIcon>
            <Text fw={600}>Feature toggles</Text>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            <Switch label="Live voice responder" defaultChecked />
            <Switch label="Ask answers in DMs" />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button
              variant="gradient"
              gradient={{ from: "brand", to: "violet" }}
            >
              Save changes
            </Button>
          </Group>
        </Stack>
      </Surface>
    </Stack>
  );
}
