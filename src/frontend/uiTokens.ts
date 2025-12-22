import type { MantineTheme } from "@mantine/core";

export const uiRadii = {
  base: "md",
  surface: "md",
  control: "md",
  badge: "sm",
  bubble: "md",
  icon: "md",
} as const;

export const pagePaddingX = { base: "md", md: "lg" } as const;
export const pagePaddingY = { base: "lg", md: "xl" } as const;
export const pagePaddingYCompact = { base: "xs", md: "sm" } as const;
export const shellHeights = { header: 72, footer: 56 } as const;
export const uiSpacing = {
  scrollAreaGutter: "sm",
} as const;

export const uiColors = {
  accentBorder: "var(--mantine-color-cyan-5)",
  highlightBorder: "var(--mantine-color-brand-6)",
  highlightBorderSoft: "var(--mantine-color-brand-4)",
  linkAccent: "var(--mantine-color-brand-4)",
} as const;

export const uiBorders = {
  defaultWidth: 1,
  accentWidth: 2,
  highlightWidth: 2,
} as const;

const uppercaseKicker = (letterSpacing: string, fontWeight: number) => ({
  textTransform: "uppercase" as const,
  letterSpacing,
  fontWeight,
});

export const uiTypography = {
  heroKicker: uppercaseKicker("0.14em", 700),
  sectionEyebrow: uppercaseKicker("0.12em", 600),
  stepKicker: uppercaseKicker("0.12em", 700),
  metricLabel: {
    textTransform: "uppercase" as const,
    fontWeight: 600,
  },
  logo: {
    letterSpacing: "-0.02em",
    lineHeight: 1,
    fontWeight: 850,
  },
} as const;

export const uiLinks = {
  plain: { textDecoration: "none" },
} as const;

export const uiEffects = {
  accentInset: `inset 4px 0 0 ${uiColors.accentBorder}`,
  activeInset: `inset 3px 0 0 ${uiColors.highlightBorder}`,
} as const;

export const uiOverlays = {
  loading: {
    blur: 2,
    backgroundOpacity: 0.3,
    radius: uiRadii.surface,
  },
  modal: {
    blur: 2,
    backgroundOpacity: 0.3,
  },
} as const;

export const uiGradients = {
  billingPanel: (isDark: boolean) =>
    isDark
      ? "linear-gradient(135deg, rgba(42, 46, 68, 0.8), rgba(30, 30, 40, 0.6))"
      : "linear-gradient(135deg, rgba(94, 100, 242, 0.08), rgba(139, 92, 246, 0.06))",
  surfaceSoft: (isDark: boolean) =>
    isDark
      ? "linear-gradient(140deg, rgba(34, 211, 238, 0.08), rgba(99, 102, 241, 0.06))"
      : "linear-gradient(140deg, rgba(34, 211, 238, 0.12), rgba(99, 102, 241, 0.06))",
} as const;

export const uiSurfaces = {
  softBackground: (isDark: boolean) =>
    isDark ? "rgba(22, 26, 36, 0.66)" : "rgba(248, 250, 255, 0.95)",
  raisedShadow: (isDark: boolean) =>
    isDark
      ? "0 18px 40px rgba(0, 0, 0, 0.45)"
      : "0 18px 40px rgba(15, 23, 42, 0.12)",
} as const;

export const portalBackground = (isDark: boolean) =>
  isDark
    ? "radial-gradient(920px 420px at 12% -12%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(820px 380px at 85% -18%, rgba(168, 85, 247, 0.24), transparent 60%), radial-gradient(600px 240px at 55% 0%, rgba(34, 211, 238, 0.18), transparent 60%)"
    : "radial-gradient(920px 420px at 12% -12%, rgba(99, 102, 241, 0.14), transparent 60%), radial-gradient(820px 380px at 85% -18%, rgba(168, 85, 247, 0.12), transparent 60%), radial-gradient(600px 240px at 55% 0%, rgba(34, 211, 238, 0.1), transparent 60%)";

export const heroBackground = (isDark: boolean) =>
  isDark
    ? "radial-gradient(900px 360px at 10% -10%, rgba(34, 211, 238, 0.24), transparent 60%), radial-gradient(900px 380px at 90% -20%, rgba(168, 85, 247, 0.26), transparent 60%), linear-gradient(135deg, rgba(94, 100, 242, 0.42), rgba(12, 15, 24, 0.22))"
    : "radial-gradient(900px 360px at 10% -10%, rgba(34, 211, 238, 0.14), transparent 60%), radial-gradient(900px 380px at 90% -20%, rgba(168, 85, 247, 0.14), transparent 60%), linear-gradient(135deg, rgba(94, 100, 242, 0.16), rgba(255, 255, 255, 0.6))";

export const shellBorder = (theme: MantineTheme, isDark: boolean) =>
  `1px solid ${isDark ? theme.colors.dark[4] : theme.colors.gray[2]}`;

export const shellHeaderBackground = (isDark: boolean) =>
  isDark ? "rgba(12, 15, 24, 0.92)" : "rgba(255, 255, 255, 0.92)";

export const shellFooterBackground = (isDark: boolean) =>
  isDark ? "rgba(12, 15, 24, 0.78)" : "rgba(255, 255, 255, 0.88)";

export const shellShadow = (isDark: boolean) =>
  isDark ? "0 12px 40px rgba(0,0,0,0.35)" : "0 12px 40px rgba(15,23,42,0.08)";

export const appBackground = (theme: MantineTheme, isDark: boolean) =>
  isDark ? "#0b1020" : theme.colors.gray[0];
