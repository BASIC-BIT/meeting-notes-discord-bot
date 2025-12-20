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
import type { AutoRecordSettings } from "../../types/db";

type ChannelOption = { value: string; label: string };

export default function Settings() {
  const { selectedGuildId, guilds, loading: guildLoading } = useGuildContext();
  const [autoRecordRules, setAutoRecordRules] = useState<AutoRecordSettings[]>(
    [],
  );
  const [autoRecordMode, setAutoRecordMode] = useState<"one" | "all">("one");
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [textChannelId, setTextChannelId] = useState<string | null>(null);
  const [loadingRules, setLoadingRules] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [voiceChannels, setVoiceChannels] = useState<ChannelOption[]>([]);
  const [textChannels, setTextChannels] = useState<ChannelOption[]>([]);
  const [context, setContext] = useState(
    "Weekly product sync focused on launches, roadmap, and blockers.",
  );
  const [tags, setTags] = useState("product, weekly");
  const [retention, setRetention] = useState("30");

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
  const isAutoRecordBusy = loadingRules || savingRules;
  const textChannelMap = useMemo(
    () =>
      new Map(textChannels.map((channel) => [channel.value, channel.label])),
    [textChannels],
  );

  useEffect(() => {
    let mounted = true;
    const loadRules = async () => {
      if (!selectedGuildId || guildLoading) {
        setAutoRecordRules([]);
        setVoiceChannels([]);
        setTextChannels([]);
        return;
      }
      if (guilds.length > 0 && !guilds.some((g) => g.id === selectedGuildId)) {
        setAutoRecordRules([]);
        setVoiceChannels([]);
        setTextChannels([]);
        return;
      }
      setLoadingRules(true);
      try {
        const [rulesRes, channelsRes] = await Promise.all([
          fetch(`/api/guilds/${selectedGuildId}/autorecord`, {
            credentials: "include",
          }),
          fetch(`/api/guilds/${selectedGuildId}/channels`, {
            credentials: "include",
          }),
        ]);
        if (!rulesRes.ok || !channelsRes.ok) {
          throw new Error("Unable to load autorecord settings");
        }
        const rulesBody = (await rulesRes.json()) as {
          rules: AutoRecordSettings[];
        };
        const channelsBody = (await channelsRes.json()) as {
          voiceChannels: Array<{ id: string; name: string }>;
          textChannels: Array<{ id: string; name: string }>;
        };
        if (!mounted) return;
        setAutoRecordRules(rulesBody.rules ?? []);
        setVoiceChannels(
          channelsBody.voiceChannels.map((channel) => ({
            value: channel.id,
            label: channel.name,
          })),
        );
        setTextChannels(
          channelsBody.textChannels.map((channel) => ({
            value: channel.id,
            label: channel.name.startsWith("#")
              ? channel.name
              : `#${channel.name}`,
          })),
        );
      } catch (err) {
        console.error("Failed to load autorecord settings", err);
      } finally {
        if (mounted) {
          setLoadingRules(false);
        }
      }
    };

    void loadRules();
    return () => {
      mounted = false;
    };
  }, [selectedGuildId, guilds, guildLoading]);

  const handleAddRule = async () => {
    if (!selectedGuildId || !textChannelId) return;
    if (autoRecordMode === "one" && !voiceChannelId) return;
    try {
      setSavingRules(true);
      const res = await fetch(`/api/guilds/${selectedGuildId}/autorecord`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: autoRecordMode,
          voiceChannelId: autoRecordMode === "one" ? voiceChannelId : undefined,
          textChannelId,
        }),
      });
      if (!res.ok) {
        throw new Error("Unable to add rule");
      }
      const body = (await res.json()) as { rule: AutoRecordSettings };
      setAutoRecordRules((prev) => [body.rule, ...prev]);
      setVoiceChannelId(null);
      setTextChannelId(null);
      setAutoRecordMode("one");
    } catch (err) {
      console.error("Failed to add autorecord rule", err);
    } finally {
      setSavingRules(false);
    }
  };

  const handleRemoveRule = async (channelId: string) => {
    if (!selectedGuildId) return;
    try {
      setSavingRules(true);
      const res = await fetch(`/api/guilds/${selectedGuildId}/autorecord`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      if (!res.ok) throw new Error("Unable to remove rule");
      setAutoRecordRules((prev) =>
        prev.filter((rule) => rule.channelId !== channelId),
      );
    } catch (err) {
      console.error("Failed to remove autorecord rule", err);
    } finally {
      setSavingRules(false);
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
            overlayProps={{ blur: 2 }}
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
              onChange={(event) => setContext(event.currentTarget.value)}
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
            <Switch label="Image generation" defaultChecked />
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
