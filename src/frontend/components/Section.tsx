import {
  Stack,
  Text,
  Title,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { ReactNode } from "react";

type SectionProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  align?: "left" | "center";
  children: ReactNode;
};

export function Section({
  title,
  description,
  eyebrow,
  align = "left",
  children,
}: SectionProps) {
  const alignText = align === "center" ? "center" : "left";
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  return (
    <Stack gap="md" align={align === "center" ? "center" : undefined}>
      {eyebrow ? (
        <Text
          tt="uppercase"
          fw={600}
          size="xs"
          c={isDark ? theme.colors.cyan[3] : theme.colors.cyan[7]}
          ta={alignText}
          style={{ letterSpacing: "0.12em" }}
        >
          {eyebrow}
        </Text>
      ) : null}
      <Title order={2} ta={alignText}>
        {title}
      </Title>
      {description ? (
        <Text c="dimmed" ta={alignText} maw={720}>
          {description}
        </Text>
      ) : null}
      {children}
    </Stack>
  );
}

export default Section;
