import {
  Button,
  Group,
  LoadingOverlay,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import FormSelect from "../../components/FormSelect";
import { uiOverlays } from "../../uiTokens";
import { TTS_VOICE_OPTIONS } from "../../../utils/ttsVoices";
import type { ChannelOption } from "../../utils/settingsChannels";

type GlobalDefaultsCardProps = {
  busy: boolean;
  canSave: boolean;
  saving: boolean;
  serverContext: string;
  onServerContextChange: (value: string) => void;
  defaultNotesChannelId: string | null;
  onDefaultNotesChannelChange: (value: string | null) => void;
  defaultTags: string;
  onDefaultTagsChange: (value: string) => void;
  textChannels: ChannelOption[];
  defaultNotesAccess?: ChannelOption;
  globalLiveVoiceEnabled: boolean;
  onGlobalLiveVoiceEnabledChange: (value: boolean) => void;
  globalLiveVoiceCommandsEnabled: boolean;
  onGlobalLiveVoiceCommandsEnabledChange: (value: boolean) => void;
  globalLiveVoiceTtsVoice: string | null;
  onGlobalLiveVoiceTtsVoiceChange: (value: string | null) => void;
  globalChatTtsEnabled: boolean;
  onGlobalChatTtsEnabledChange: (value: boolean) => void;
  globalChatTtsVoice: string | null;
  onGlobalChatTtsVoiceChange: (value: string | null) => void;
  recordAllEnabled: boolean;
  onRecordAllEnabledChange: (value: boolean) => void;
  onSave: () => void;
};

export function GlobalDefaultsCard({
  busy,
  canSave,
  saving,
  serverContext,
  onServerContextChange,
  defaultNotesChannelId,
  onDefaultNotesChannelChange,
  defaultTags,
  onDefaultTagsChange,
  textChannels,
  defaultNotesAccess,
  globalLiveVoiceEnabled,
  onGlobalLiveVoiceEnabledChange,
  globalLiveVoiceCommandsEnabled,
  onGlobalLiveVoiceCommandsEnabledChange,
  globalLiveVoiceTtsVoice,
  onGlobalLiveVoiceTtsVoiceChange,
  globalChatTtsEnabled,
  onGlobalChatTtsEnabledChange,
  globalChatTtsVoice,
  onGlobalChatTtsVoiceChange,
  recordAllEnabled,
  onRecordAllEnabledChange,
  onSave,
}: GlobalDefaultsCardProps) {
  const recordAllRequiresNotesChannel =
    recordAllEnabled && !defaultNotesChannelId;

  return (
    <Stack
      p="lg"
      style={{ position: "relative", overflow: "hidden" }}
      data-testid="settings-defaults"
      component="section"
    >
      <LoadingOverlay
        visible={busy}
        data-testid="settings-loading-defaults"
        overlayProps={uiOverlays.loading}
        loaderProps={{ size: "md" }}
      />
      <Stack gap="md">
        <Group gap="sm">
          <ThemeIcon variant="light" color="brand">
            <IconSettings size={18} />
          </ThemeIcon>
          <Text fw={600}>Server defaults</Text>
        </Group>
        <Stack gap="sm">
          <TextInput
            label="Server context (optional)"
            placeholder="What should Chronote know about this server?"
            value={serverContext}
            onChange={(event) =>
              onServerContextChange(event.currentTarget.value)
            }
            disabled={busy}
            data-testid="settings-server-context"
          />
          <TextInput
            label="Default tags (comma separated)"
            placeholder="project x, roadmap, weekly"
            value={defaultTags}
            onChange={(event) => onDefaultTagsChange(event.currentTarget.value)}
            disabled={busy}
            data-testid="settings-default-tags"
          />
          <FormSelect
            label="Default notes channel"
            placeholder={
              defaultNotesAccess ? undefined : "Select a text channel"
            }
            data={textChannels.map((channel) => ({
              value: channel.value,
              label: channel.label,
              disabled: !channel.botAccess,
            }))}
            value={defaultNotesChannelId}
            onChange={onDefaultNotesChannelChange}
            searchable
            clearable
            disabled={busy}
            data-testid="settings-default-notes-channel"
          />
          {defaultNotesAccess?.botAccess === false ? (
            <Text size="xs" c="red">
              Grant bot access to {defaultNotesAccess.label} for notes posting.
            </Text>
          ) : null}
        </Stack>

        <Stack gap="sm">
          <Text fw={600}>Live voice defaults</Text>
          <Group>
            <Button
              variant={globalLiveVoiceEnabled ? "filled" : "default"}
              onClick={() =>
                onGlobalLiveVoiceEnabledChange(!globalLiveVoiceEnabled)
              }
              disabled={busy}
            >
              {globalLiveVoiceEnabled ? "Live voice on" : "Live voice off"}
            </Button>
            <Button
              variant={globalLiveVoiceCommandsEnabled ? "filled" : "default"}
              onClick={() =>
                onGlobalLiveVoiceCommandsEnabledChange(
                  !globalLiveVoiceCommandsEnabled,
                )
              }
              disabled={busy}
            >
              Commands {globalLiveVoiceCommandsEnabled ? "on" : "off"}
            </Button>
          </Group>
          <FormSelect
            label="Live voice TTS voice"
            data={TTS_VOICE_OPTIONS}
            value={globalLiveVoiceTtsVoice}
            onChange={onGlobalLiveVoiceTtsVoiceChange}
            searchable
            clearable
            disabled={busy}
          />
          <Group>
            <Button
              variant={globalChatTtsEnabled ? "filled" : "default"}
              onClick={() =>
                onGlobalChatTtsEnabledChange(!globalChatTtsEnabled)
              }
              disabled={busy}
            >
              Chat TTS {globalChatTtsEnabled ? "on" : "off"}
            </Button>
            <FormSelect
              data={TTS_VOICE_OPTIONS}
              value={globalChatTtsVoice}
              onChange={onGlobalChatTtsVoiceChange}
              searchable
              clearable
              placeholder="Chat TTS voice"
              disabled={busy || !globalChatTtsEnabled}
            />
          </Group>
          <Button
            variant={recordAllEnabled ? "filled" : "default"}
            onClick={() => onRecordAllEnabledChange(!recordAllEnabled)}
            disabled={busy}
            data-testid="settings-record-all"
          >
            {recordAllEnabled ? "Record all voice channels" : "Record manually"}
          </Button>
          {recordAllRequiresNotesChannel ? (
            <Stack gap={2}>
              <Text size="xs" c="red">
                Recording all channels uses the default notes channel.
              </Text>
              <Text size="xs" c="red">
                Default notes channel is required when record all is enabled.
              </Text>
            </Stack>
          ) : null}
        </Stack>

        <Group justify="flex-end">
          <Button
            variant="light"
            onClick={onSave}
            disabled={!canSave || busy}
            loading={saving}
            data-testid="settings-save-defaults"
          >
            Save defaults
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
