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

export default function MarketingLayout() {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("dark");
  const isDark = colorScheme === "dark";

  return (
    <AppShell
      padding={0}
      header={{ height: 72 }}
      styles={{
        header: {
          borderBottom: `1px solid ${
            isDark ? theme.colors.dark[4] : theme.colors.gray[2]
          }`,
          backgroundColor: isDark
            ? "rgba(12, 15, 24, 0.92)"
            : "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(16px)",
          boxShadow: isDark
            ? "0 12px 40px rgba(0,0,0,0.35)"
            : "0 12px 40px rgba(15,23,42,0.08)",
        },
        main: {
          backgroundColor: isDark ? "#0b1020" : theme.colors.gray[0],
        },
      }}
    >
      <AppShell.Header p="md">
        <SiteHeader
          showNavbarToggle={false}
          navbarOpened={false}
          onNavbarToggle={() => {}}
        />
      </AppShell.Header>
      <AppShell.Main>
        <Box
          py={{ base: "xl", md: "xl" }}
          style={{
            backgroundImage: isDark
              ? "radial-gradient(920px 420px at 12% -12%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(820px 380px at 85% -18%, rgba(168, 85, 247, 0.24), transparent 60%), radial-gradient(600px 240px at 55% 0%, rgba(34, 211, 238, 0.18), transparent 60%)"
              : "radial-gradient(920px 420px at 12% -12%, rgba(99, 102, 241, 0.14), transparent 60%), radial-gradient(820px 380px at 85% -18%, rgba(168, 85, 247, 0.12), transparent 60%), radial-gradient(600px 240px at 55% 0%, rgba(34, 211, 238, 0.1), transparent 60%)",
          }}
        >
          <Container size="xl" px={{ base: "md", md: "lg" }}>
            <Home />
          </Container>
          <SiteFooter />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
