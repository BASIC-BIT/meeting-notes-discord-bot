import {
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { ConfigEntryInput } from "../types/configEntry";
import FormSelect from "./FormSelect";
import type { ChannelOption } from "../utils/settingsChannels";
import { clampNumberValue, resolveNumberRange } from "../../config/validation";

type ConfigValueFieldProps = {
  entry: ConfigEntryInput;
  value: unknown;
  onChange: (value: unknown) => void;
  onOverrideIntent?: (value?: unknown) => void;
  disabled?: boolean;
  uiContext?: ConfigUiContext;
};

type CustomRenderer = (props: ConfigValueFieldProps) => ReactNode;
export type ConfigUiContext = {
  textChannels?: ChannelOption[];
  ttsVoiceOptions?: Array<{ value: string; label: string }>;
  resolvedValues?: Record<string, unknown>;
};

const formatOptionLabel = (option: string) =>
  option
    .split(/[\s-_]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const AskSharingPolicySegment: CustomRenderer = ({
  entry,
  value,
  onChange,
  onOverrideIntent,
  disabled,
}) => {
  const options = entry.ui.type === "custom" ? ["off", "server", "public"] : [];
  return (
    <SegmentedControl
      value={typeof value === "string" ? value : ""}
      onChange={(next) => onChange(next)}
      onClickCapture={() => {
        if (!disabled) onOverrideIntent?.(value);
      }}
      data={options.map((option) => ({
        value: option,
        label: formatOptionLabel(option),
      }))}
      fullWidth
      aria-label={entry.key}
      disabled={disabled}
    />
  );
};

const NotesChannelSelect: CustomRenderer = ({
  entry,
  value,
  onChange,
  onOverrideIntent,
  disabled,
  uiContext,
}) => {
  const textChannels = uiContext?.textChannels ?? [];
  if (textChannels.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No text channels available.
      </Text>
    );
  }
  const selected =
    typeof value === "string"
      ? textChannels.find((channel) => channel.value === value)
      : undefined;
  return (
    <Stack gap={4}>
      <FormSelect
        aria-label={entry.key}
        data={textChannels.map((channel) => ({
          value: channel.value,
          label: channel.label,
          disabled: !channel.botAccess,
        }))}
        value={typeof value === "string" ? value : null}
        onChange={(next) => {
          if (next !== null) onChange(next);
        }}
        onOptionSubmit={(next) => onOverrideIntent?.(next)}
        searchable
        disabled={disabled}
        placeholder="Select a text channel"
      />
      {selected && !selected.botAccess ? (
        <Text size="xs" c="red">
          Grant bot access to {selected.label} for notes posting.
        </Text>
      ) : null}
    </Stack>
  );
};

const TtsVoiceSelect: CustomRenderer = ({
  entry,
  value,
  onChange,
  onOverrideIntent,
  disabled,
  uiContext,
}) => {
  const options = uiContext?.ttsVoiceOptions ?? [];
  if (options.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No voice options available.
      </Text>
    );
  }
  return (
    <FormSelect
      aria-label={entry.key}
      data={options}
      value={typeof value === "string" ? value : null}
      onChange={(next) => {
        if (next !== null) onChange(next);
      }}
      onOptionSubmit={(next) => onOverrideIntent?.(next)}
      searchable
      disabled={disabled}
      placeholder="Select a voice"
    />
  );
};

const customRenderers: Record<string, CustomRenderer> = {
  AskSharingPolicySegment,
  NotesChannelSelect,
  TtsVoiceSelect,
};

export function ConfigValueField({
  entry,
  value,
  onChange,
  onOverrideIntent,
  disabled,
  uiContext,
}: ConfigValueFieldProps) {
  if (entry.ui.type === "custom") {
    const renderer = customRenderers[entry.ui.renderer];
    if (renderer) {
      return renderer({
        entry,
        value,
        onChange,
        onOverrideIntent,
        disabled,
        uiContext,
      });
    }
    return (
      <Text size="sm" c="dimmed">
        Custom control unavailable.
      </Text>
    );
  }

  if (entry.ui.type === "toggle") {
    const toggleValue = value ? "on" : "off";
    return (
      <SegmentedControl
        aria-label={entry.key}
        value={toggleValue}
        onChange={(next) => onChange(next === "on")}
        onClickCapture={() => {
          if (!disabled) onOverrideIntent?.(value);
        }}
        data={[
          { label: "Off", value: "off" },
          { label: "On", value: "on" },
        ]}
        fullWidth
        disabled={disabled}
      />
    );
  }

  if (entry.ui.type === "number") {
    const range = resolveNumberRange(entry, uiContext?.resolvedValues);
    return (
      <NumberInput
        aria-label={entry.key}
        value={typeof value === "number" ? value : undefined}
        onChange={(next) => {
          if (typeof next === "number") {
            onChange(clampNumberValue(next, range));
          }
        }}
        min={range.min}
        max={range.max}
        step={entry.ui.step}
        disabled={disabled}
      />
    );
  }

  if (entry.ui.type === "select") {
    return (
      <Select
        aria-label={entry.key}
        data={entry.ui.options ?? []}
        value={typeof value === "string" ? value : null}
        onChange={(next) => {
          if (next !== null) onChange(next);
        }}
        onOptionSubmit={(next) => onOverrideIntent?.(next)}
        disabled={disabled}
        placeholder={entry.ui.placeholder}
      />
    );
  }

  if (entry.ui.type === "segmented") {
    return (
      <SegmentedControl
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next)}
        onClickCapture={() => {
          if (!disabled) onOverrideIntent?.(value);
        }}
        data={(entry.ui.options ?? []).map((option) => ({
          value: option,
          label: formatOptionLabel(option),
        }))}
        fullWidth
        aria-label={entry.key}
        disabled={disabled}
      />
    );
  }

  if (entry.ui.type === "text") {
    return (
      <TextInput
        aria-label={entry.key}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={disabled}
        placeholder={entry.ui.placeholder}
      />
    );
  }

  return null;
}
