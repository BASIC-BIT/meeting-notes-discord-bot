import { Badge, Group, Stack, Text, Title } from "@mantine/core";

type PageHeaderProps = {
  title: string;
  description?: string;
  badge?: string;
};

export function PageHeader({ title, description, badge }: PageHeaderProps) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="baseline" gap="sm" wrap="wrap">
        <Group align="center" gap="sm">
          <Title order={2}>{title}</Title>
          {badge ? (
            <Badge variant="light" color="cyan">
              {badge}
            </Badge>
          ) : null}
        </Group>
        {description ? (
          <Text size="sm" c="dimmed" ta="right" lineClamp={1} truncate="end">
            {description}
          </Text>
        ) : null}
      </Group>
    </Stack>
  );
}

export default PageHeader;
