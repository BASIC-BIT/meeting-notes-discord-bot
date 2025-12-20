import {
  Paper,
  PaperProps,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";

type SurfaceProps = PaperProps &
  ComponentPropsWithoutRef<"div"> & {
    tone?: "default" | "raised" | "soft";
  };

export function Surface({ tone = "default", style, ...props }: SurfaceProps) {
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";

  const accentGlow = isDark
    ? "linear-gradient(140deg, rgba(34, 211, 238, 0.08), rgba(99, 102, 241, 0.06))"
    : "linear-gradient(140deg, rgba(34, 211, 238, 0.12), rgba(99, 102, 241, 0.06))";

  const backgroundColor =
    tone === "soft"
      ? isDark
        ? "rgba(22, 26, 36, 0.66)"
        : "rgba(248, 250, 255, 0.95)"
      : isDark
        ? theme.colors.dark[6]
        : theme.white;

  const borderColor = isDark ? theme.colors.dark[4] : theme.colors.gray[2];

  const shadow =
    tone === "raised"
      ? isDark
        ? "0 18px 40px rgba(0, 0, 0, 0.45)"
        : "0 18px 40px rgba(15, 23, 42, 0.12)"
      : undefined;

  return (
    <Paper
      withBorder
      radius="xl"
      shadow={tone === "raised" ? undefined : "sm"}
      style={{
        backgroundColor,
        backgroundImage: tone === "soft" ? accentGlow : undefined,
        borderColor,
        boxShadow: shadow,
        ...style,
      }}
      {...props}
    />
  );
}

export default Surface;
