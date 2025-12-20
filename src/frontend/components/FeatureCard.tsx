import { Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { ReactNode } from "react";
import Surface from "./Surface";

type FeatureCardProps = {
  title: string;
  description: string;
  icon: ReactNode;
  color?: string;
};

export function FeatureCard({
  title,
  description,
  icon,
  color = "brand",
}: FeatureCardProps) {
  return (
    <Surface p="lg">
      <Stack gap="sm">
        <ThemeIcon size={44} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Title order={4}>{title}</Title>
        <Text c="dimmed">{description}</Text>
      </Stack>
    </Surface>
  );
}

export default FeatureCard;
