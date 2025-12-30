import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  LoadingOverlay,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import Surface from "../components/Surface";
import { trpc } from "../services/trpc";
import { useAuth } from "../contexts/AuthContext";
import { uiOverlays } from "../uiTokens";

type RegistryEntry = {
  key: string;
  label: string;
  description: string;
  category: string;
  valueType: string;
  defaultValue: unknown;
  ui: {
    type: "toggle" | "text" | "number" | "select";
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
  };
};

export default function AdminConfig() {
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const globalQuery = trpc.config.global.useQuery(undefined, {
    enabled: isSuperAdmin,
  });
  const setGlobal = trpc.config.setGlobal.useMutation({
    onSuccess: () => globalQuery.refetch(),
  });
  const clearGlobal = trpc.config.clearGlobal.useMutation({
    onSuccess: () => globalQuery.refetch(),
  });

  const registry = (globalQuery.data?.registry ?? []) as RegistryEntry[];
  const values = globalQuery.data?.values ?? [];
  const valuesByKey = useMemo(() => {
    const map = new Map<string, { value?: unknown; source: string }>();
    values.forEach((entry) => {
      map.set(entry.key, entry);
    });
    return map;
  }, [values]);

  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const next: Record<string, unknown> = {};
    registry.forEach((entry) => {
      const current = valuesByKey.get(entry.key);
      next[entry.key] =
        current?.value !== undefined ? current.value : entry.defaultValue;
    });
    setLocalValues(next);
  }, [registry, valuesByKey]);

  if (!isSuperAdmin) {
    return (
      <Surface tone="soft" p="xl">
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="red"
          variant="light"
        >
          Super admin access is required to view this page.
        </Alert>
      </Surface>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Title order={2}>Admin configuration</Title>
          <Text size="sm" c="dimmed">
            Manage global configuration overrides. Changes apply across all
            servers unless overridden at a narrower scope.
          </Text>
        </Stack>
      </Group>

      <Surface tone="raised" p="lg" style={{ position: "relative" }}>
        <LoadingOverlay
          visible={globalQuery.isLoading}
          overlayProps={uiOverlays.loading}
          loaderProps={{ size: "md" }}
        />
        <Stack gap="md">
          {registry.length === 0 ? (
            <Text c="dimmed">No configuration entries available.</Text>
          ) : (
            registry.map((entry) => {
              const current = valuesByKey.get(entry.key);
              const value = localValues[entry.key];
              const source = current?.source ?? "default";
              const disabled =
                globalQuery.isLoading ||
                setGlobal.isPending ||
                clearGlobal.isPending;

              return (
                <Surface key={entry.key} tone="soft" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Stack gap={2}>
                        <Text fw={600}>{entry.label}</Text>
                        <Text size="sm" c="dimmed">
                          {entry.description}
                        </Text>
                      </Stack>
                      <Badge variant="light" color="gray">
                        {source}
                      </Badge>
                    </Group>

                    {entry.ui.type === "toggle" ? (
                      <Switch
                        checked={Boolean(value)}
                        onChange={(event) =>
                          setLocalValues((prev) => ({
                            ...prev,
                            [entry.key]: event.currentTarget.checked,
                          }))
                        }
                        label={entry.key}
                        disabled={disabled}
                      />
                    ) : null}

                    {entry.ui.type === "number" ? (
                      <NumberInput
                        label={entry.key}
                        value={typeof value === "number" ? value : undefined}
                        onChange={(next) =>
                          setLocalValues((prev) => ({
                            ...prev,
                            [entry.key]:
                              typeof next === "number" ? next : prev[entry.key],
                          }))
                        }
                        min={entry.ui.min}
                        max={entry.ui.max}
                        step={entry.ui.step}
                        disabled={disabled}
                      />
                    ) : null}

                    {entry.ui.type === "select" ? (
                      <Select
                        label={entry.key}
                        data={entry.ui.options ?? []}
                        value={typeof value === "string" ? value : null}
                        onChange={(next) =>
                          setLocalValues((prev) => ({
                            ...prev,
                            [entry.key]: next ?? prev[entry.key],
                          }))
                        }
                        disabled={disabled}
                      />
                    ) : null}

                    {entry.ui.type === "text" ? (
                      <TextInput
                        label={entry.key}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) =>
                          setLocalValues((prev) => ({
                            ...prev,
                            [entry.key]: event.currentTarget.value,
                          }))
                        }
                        disabled={disabled}
                      />
                    ) : null}

                    <Group justify="flex-end">
                      <Button
                        variant="default"
                        onClick={() => clearGlobal.mutate({ key: entry.key })}
                        disabled={disabled}
                      >
                        Clear override
                      </Button>
                      <Button
                        onClick={() =>
                          setGlobal.mutate({
                            key: entry.key,
                            value: localValues[entry.key],
                          })
                        }
                        disabled={disabled}
                      >
                        Save override
                      </Button>
                    </Group>
                  </Stack>
                </Surface>
              );
            })
          )}
        </Stack>
      </Surface>
    </Stack>
  );
}
