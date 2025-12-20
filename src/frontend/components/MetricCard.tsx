import { Group, Stack, Text } from "@mantine/core";
import Surface from "./Surface";

type MetricCardProps = {
  label: string;
  value: string;
  helper?: string;
  trend?: string;
};

export function MetricCard({ label, value, helper, trend }: MetricCardProps) {
  return (
    <Surface p="md" tone="soft">
      <Stack gap={4}>
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          {trend ? (
            <Text size="xs" c="dimmed" fw={600}>
              {trend}
            </Text>
          ) : null}
        </Group>
        <Text fw={700} size="xl">
          {value}
        </Text>
        {helper ? (
          <Text size="xs" c="dimmed">
            {helper}
          </Text>
        ) : null}
      </Stack>
    </Surface>
  );
}

export default MetricCard;
