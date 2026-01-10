import { Button, Group, Stack, Text } from "@mantine/core";
import type { ConfigEntryInput } from "../types/configEntry";
import { ConfigValueField, type ConfigUiContext } from "./ConfigValueField";
import Surface from "./Surface";
import {
  ALL_CONFIG_SCOPES,
  formatScopeLabel,
  resolveScopeConfigInput,
} from "../utils/configScopes";

export type ConfigMode = "default" | "override";

type AdminConfigEntryCardProps = {
  entry: ConfigEntryInput;
  value: unknown;
  mode: ConfigMode;
  source: string;
  disabled: boolean;
  uiContext?: ConfigUiContext;
  onValueChange: (value: unknown) => void;
  onOverrideIntent?: (value?: unknown) => void;
  onReset?: () => void;
};

const buildScopeMetaLabel = (
  scope: string,
  enabled: boolean,
  required: boolean,
  role: string,
  control: string,
) => {
  if (!enabled) return `${scope}: disabled`;
  const requirement = required ? "required" : "optional";
  return `${scope}: ${requirement} / ${role} / ${control}`;
};

const SOURCE_LABELS: Record<string, string> = {
  appconfig: "AppConfig",
  default: "Default",
  experimental: "Experimental",
  server: "Server",
  channel: "Channel",
  user: "User",
  meeting: "Meeting",
  gated: "Gated",
};

const formatSourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

export function AdminConfigEntryCard({
  entry,
  value,
  mode,
  source,
  disabled,
  uiContext,
  onValueChange,
  onOverrideIntent,
  onReset,
}: AdminConfigEntryCardProps) {
  const fieldDisabled = disabled;
  const entryTestId = `admin-config-entry-${entry.key}`;
  const isOverridden = mode === "override";
  const isMissingValue = value === undefined || value === null;
  const statusLabel = isOverridden
    ? isMissingValue
      ? "Status: Needs value"
      : "Status: Overridden"
    : `Status: Inherited from ${formatSourceLabel(source)}`;
  const canReset =
    isOverridden && !disabled && entry.defaultValue !== undefined;

  return (
    <Surface
      tone={isOverridden ? "default" : "soft"}
      p="md"
      data-testid={entryTestId}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={2}>
            <Text fw={600}>{entry.label}</Text>
            <Text size="sm" c="dimmed">
              {entry.description}
            </Text>
            <Text size="xs" c="dimmed">
              Key: {entry.key}
            </Text>
          </Stack>
          <Stack gap={2} align="flex-end">
            <Text size="xs" c="dimmed">
              {statusLabel}
            </Text>
          </Stack>
        </Group>

        <Stack gap={2}>
          {ALL_CONFIG_SCOPES.map((scope) => {
            const scopeConfig = resolveScopeConfigInput(entry, scope);
            const label = buildScopeMetaLabel(
              formatScopeLabel(scope),
              scopeConfig.enabled,
              scopeConfig.required,
              scopeConfig.role,
              scopeConfig.control,
            );
            return (
              <Text key={scope} size="xs" c="dimmed">
                {label}
              </Text>
            );
          })}
        </Stack>

        {canReset ? (
          <Group justify="flex-end">
            <Button
              size="xs"
              variant="subtle"
              onClick={onReset}
              data-testid={`${entryTestId}-reset`}
            >
              Reset
            </Button>
          </Group>
        ) : null}

        <ConfigValueField
          entry={entry}
          value={value}
          onChange={onValueChange}
          onOverrideIntent={onOverrideIntent}
          disabled={fieldDisabled}
          uiContext={uiContext}
        />
      </Stack>
    </Surface>
  );
}
