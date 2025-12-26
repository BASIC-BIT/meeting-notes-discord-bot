import {
  AppShell,
  Box,
  Container,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import Home from "../pages/Home";
import {
  appBackground,
  pagePaddingX,
  portalBackground,
  shellBorder,
  shellHeaderBackground,
  shellHeights,
  shellShadow,
} from "../uiTokens";

export default function MarketingLayout() {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("dark");
  const isDark = colorScheme === "dark";

  return (
    <AppShell
      padding={0}
      header={{ height: shellHeights.header }}
      styles={{
        header: {
          borderBottom: shellBorder(theme, isDark),
          backgroundColor: shellHeaderBackground(isDark),
          backdropFilter: "blur(16px)",
          boxShadow: shellShadow(isDark),
        },
        main: {
          backgroundColor: appBackground(theme, isDark),
        },
      }}
    >
      <AppShell.Header p="md">
        <SiteHeader
          showNavbarToggle={false}
          navbarOpened={false}
          onNavbarToggle={() => {}}
          context="marketing"
        />
      </AppShell.Header>
      <AppShell.Main>
        <Box
          py={{ base: "xl", md: "xl" }}
          style={{
            backgroundImage: portalBackground(isDark),
          }}
        >
          <Container size="xl" px={pagePaddingX}>
            <Home />
          </Container>
          <SiteFooter />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
