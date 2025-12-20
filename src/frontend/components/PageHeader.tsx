import { Badge, Group, Stack, Text, Title } from "@mantine/core";

type PageHeaderProps = {
  title: string;
  description?: string;
  badge?: string;
};

export function PageHeader({ title, description, badge }: PageHeaderProps) {
  return (
    <Stack gap="xs">
      <Group align="center" gap="sm">
        <Title order={2}>{title}</Title>
        {badge ? (
          <Badge variant="light" color="cyan">
            {badge}
          </Badge>
        ) : null}
      </Group>
      {description ? <Text c="dimmed">{description}</Text> : null}
    </Stack>
  );
}

export default PageHeader;
