import {
  Paper,
  PaperProps,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import { uiGradients, uiRadii, uiSurfaces } from "../uiTokens";

type SurfaceProps = PaperProps &
  ComponentPropsWithoutRef<"div"> & {
    tone?: "default" | "raised" | "soft";
  };

export function Surface({ tone = "default", style, ...props }: SurfaceProps) {
  const theme = useMantineTheme();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";

  const backgroundColor =
    tone === "soft"
      ? uiSurfaces.softBackground(isDark)
      : isDark
        ? theme.colors.dark[6]
        : theme.white;

  const borderColor = isDark ? theme.colors.dark[4] : theme.colors.gray[2];

  const shadow =
    tone === "raised" ? uiSurfaces.raisedShadow(isDark) : undefined;

  return (
    <Paper
      withBorder
      radius={uiRadii.surface}
      shadow={tone === "raised" ? undefined : "sm"}
      style={{
        backgroundColor,
        backgroundImage:
          tone === "soft" ? uiGradients.surfaceSoft(isDark) : undefined,
        borderColor,
        boxShadow: shadow,
        ...style,
      }}
      {...props}
    />
  );
}

export default Surface;
