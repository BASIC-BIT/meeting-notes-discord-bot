import {
  Button,
  Group,
  LoadingOverlay,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconShare2 } from "@tabler/icons-react";
import { uiOverlays } from "../../uiTokens";

type AskSharingPolicy = "off" | "server" | "public";

type AskSharingCardProps = {
  askMembersEnabled: boolean;
  askSharingPolicy: AskSharingPolicy;
  askBusy: boolean;
  canSaveAsk: boolean;
  savingAsk: boolean;
  onMembersChange: (value: boolean) => void;
  onPolicyChange: (value: AskSharingPolicy) => void;
  onSave: () => void;
};

export function AskSharingCard({
  askMembersEnabled,
  askSharingPolicy,
  askBusy,
  canSaveAsk,
  savingAsk,
  onMembersChange,
  onPolicyChange,
  onSave,
}: AskSharingCardProps) {
  return (
    <Stack
      p="lg"
      style={{ position: "relative", overflow: "hidden" }}
      component="section"
      data-testid="settings-ask"
    >
      <LoadingOverlay
        visible={askBusy}
        data-testid="settings-loading-ask"
        overlayProps={uiOverlays.loading}
        loaderProps={{ size: "md" }}
      />
      <Stack gap="md">
        <Group gap="sm">
          <ThemeIcon variant="light" color="brand">
            <IconShare2 size={18} />
          </ThemeIcon>
          <Text fw={600}>Ask access and sharing</Text>
        </Group>
        <Text size="sm" c="dimmed">
          Control who can use Ask and whether members can share threads.
        </Text>
        <Switch
          label="Allow server members to use Ask"
          checked={askMembersEnabled}
          onChange={(event) => onMembersChange(event.currentTarget.checked)}
          disabled={askBusy}
        />
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Sharing policy
          </Text>
          <SegmentedControl
            value={askSharingPolicy}
            onChange={(value) => onPolicyChange(value as AskSharingPolicy)}
            data={[
              { label: "Off", value: "off" },
              { label: "Server", value: "server" },
              { label: "Public", value: "public" },
            ]}
            fullWidth
            disabled={askBusy}
          />
          <Text size="xs" c="dimmed">
            Sharing is opt-in per thread, and shared threads display the
            author&apos;s Discord name. Public links are read only and visible
            without login.
          </Text>
        </Stack>
        <Group justify="flex-end">
          <Button
            variant="light"
            onClick={onSave}
            disabled={!canSaveAsk || askBusy}
            loading={savingAsk}
            data-testid="settings-save-ask"
          >
            Save Ask settings
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
