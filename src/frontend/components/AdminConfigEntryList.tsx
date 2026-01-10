import { Accordion, Stack, Text } from "@mantine/core";
import {
  CONFIG_GROUP_ORDER,
  PRIMARY_CONFIG_GROUPS,
  resolveConfigGroup,
} from "../../config/grouping";
import type { ConfigEntryInput } from "../types/configEntry";
import { AdminConfigEntryCard, type ConfigMode } from "./AdminConfigEntryCard";
import type { ConfigUiContext } from "./ConfigValueField";
import { resolveScopeConfigInput } from "../utils/configScopes";

type AdminConfigEntryListProps = {
  entries: ConfigEntryInput[];
  valuesByKey: Map<string, { value?: unknown; source: string }>;
  localValues: Record<string, unknown>;
  localModes: Record<string, ConfigMode>;
  disabled: boolean;
  missingRequired?: string[];
  uiContext?: ConfigUiContext;
  onModeChange: (
    updater: (prev: Record<string, ConfigMode>) => Record<string, ConfigMode>,
  ) => void;
  onValueChange: (
    updater: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  onDirty: () => void;
};

type AdminConfigEntryRowProps = {
  entry: ConfigEntryInput;
  valuesByKey: Map<string, { value?: unknown; source: string }>;
  localValues: Record<string, unknown>;
  localModes: Record<string, ConfigMode>;
  disabled: boolean;
  uiContext?: ConfigUiContext;
  onModeChange: AdminConfigEntryListProps["onModeChange"];
  onValueChange: AdminConfigEntryListProps["onValueChange"];
  onDirty: () => void;
};

function AdminConfigEntryRow({
  entry,
  valuesByKey,
  localValues,
  localModes,
  disabled,
  uiContext,
  onModeChange,
  onValueChange,
  onDirty,
}: AdminConfigEntryRowProps) {
  const current = valuesByKey.get(entry.key);
  const value = localValues[entry.key];
  const source = current?.source ?? "appconfig";
  const mode = localModes[entry.key] ?? "default";

  const handleValueChange = (nextValue: unknown) => {
    onValueChange((prev) => ({ ...prev, [entry.key]: nextValue }));
    onModeChange((prev) => ({ ...prev, [entry.key]: "override" }));
    onDirty();
  };

  const handleOverrideIntent = (nextValue?: unknown) => {
    onModeChange((prev) => ({ ...prev, [entry.key]: "override" }));
    if (nextValue !== undefined) {
      onValueChange((prev) => ({ ...prev, [entry.key]: nextValue }));
    }
    onDirty();
  };

  const handleReset = () => {
    const scopeConfig = resolveScopeConfigInput(entry, "global");
    onValueChange((prev) => ({
      ...prev,
      [entry.key]: entry.defaultValue ?? undefined,
    }));
    onModeChange((prev) => ({
      ...prev,
      [entry.key]:
        scopeConfig.required && entry.defaultValue === undefined
          ? "override"
          : "default",
    }));
    onDirty();
  };

  return (
    <AdminConfigEntryCard
      entry={entry}
      value={value}
      mode={mode}
      source={source}
      disabled={disabled}
      uiContext={uiContext}
      onValueChange={handleValueChange}
      onOverrideIntent={handleOverrideIntent}
      onReset={handleReset}
    />
  );
}

export function AdminConfigEntryList({
  entries,
  valuesByKey,
  localValues,
  localModes,
  disabled,
  missingRequired,
  uiContext,
  onModeChange,
  onValueChange,
  onDirty,
}: AdminConfigEntryListProps) {
  if (entries.length === 0) {
    return <Text c="dimmed">No configuration entries available.</Text>;
  }

  const missingSet = new Set(missingRequired ?? []);
  const needsAttention = entries.filter((entry) => missingSet.has(entry.key));
  const remaining = entries.filter((entry) => !missingSet.has(entry.key));
  const grouped = new Map<string, Map<string, ConfigEntryInput[]>>();
  remaining.forEach((entry) => {
    const group = resolveConfigGroup(entry);
    const category = entry.category || "General";
    if (!grouped.has(group)) {
      grouped.set(group, new Map());
    }
    const groupMap = grouped.get(group)!;
    if (!groupMap.has(category)) {
      groupMap.set(category, []);
    }
    groupMap.get(category)!.push(entry);
  });
  const orderedGroups = [
    ...CONFIG_GROUP_ORDER.filter((group) => grouped.has(group)),
    ...Array.from(grouped.keys()).filter(
      (group) => !CONFIG_GROUP_ORDER.some((candidate) => candidate === group),
    ),
  ];
  const primaryGroups = orderedGroups.filter((group) =>
    PRIMARY_CONFIG_GROUPS.some((candidate) => candidate === group),
  );
  const secondaryGroups = orderedGroups.filter(
    (group) => !primaryGroups.includes(group),
  );

  const renderGroupSections = (
    groupEntries: Map<string, ConfigEntryInput[]>,
  ) => (
    <Stack gap="sm">
      {Array.from(groupEntries.entries()).map(([category, categoryEntries]) => (
        <Stack key={category} gap="sm">
          <Text fw={600}>{category}</Text>
          {categoryEntries.map((entry) => (
            <AdminConfigEntryRow
              key={entry.key}
              entry={entry}
              valuesByKey={valuesByKey}
              localValues={localValues}
              localModes={localModes}
              disabled={disabled}
              uiContext={uiContext}
              onModeChange={onModeChange}
              onValueChange={onValueChange}
              onDirty={onDirty}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );

  return (
    <Stack gap="lg">
      {needsAttention.length > 0 ? (
        <Stack gap="sm">
          <Text fw={600}>Needs attention</Text>
          {needsAttention.map((entry) => (
            <AdminConfigEntryRow
              key={entry.key}
              entry={entry}
              valuesByKey={valuesByKey}
              localValues={localValues}
              localModes={localModes}
              disabled={disabled}
              uiContext={uiContext}
              onModeChange={onModeChange}
              onValueChange={onValueChange}
              onDirty={onDirty}
            />
          ))}
        </Stack>
      ) : null}

      {primaryGroups.map((group) => {
        const groupEntries = grouped.get(group);
        if (!groupEntries) return null;
        return (
          <Stack key={group} gap="sm">
            <Text fw={600}>{group}</Text>
            {renderGroupSections(groupEntries)}
          </Stack>
        );
      })}

      {secondaryGroups.length > 0 ? (
        <Accordion multiple variant="contained">
          {secondaryGroups.map((group) => {
            const groupEntries = grouped.get(group);
            if (!groupEntries) return null;
            return (
              <Accordion.Item key={group} value={group}>
                <Accordion.Control>{group}</Accordion.Control>
                <Accordion.Panel>
                  {renderGroupSections(groupEntries)}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      ) : null}
    </Stack>
  );
}
