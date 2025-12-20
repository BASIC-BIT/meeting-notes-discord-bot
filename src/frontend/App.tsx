import {
  AppShell,
  Box,
  Container,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import Billing from "./pages/Billing";
import { GuildProvider, useGuildContext } from "./contexts/GuildContext";
import { useAuth } from "./contexts/AuthContext";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Ask from "./pages/Ask";
import Settings from "./pages/Settings";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import ServerSelect from "./pages/ServerSelect";
import SiteNavbar from "./components/SiteNavbar";

type PageKey =
  | "home"
  | "library"
  | "ask"
  | "billing"
  | "settings"
  | "select-server";

const AUTH_PAGES = new Set<PageKey>([
  "library",
  "ask",
  "billing",
  "settings",
  "select-server",
]);

function AppShellContent() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [pendingPage, setPendingPage] = useState<PageKey | null>(null);
  const [navbarOpened, navbarHandlers] = useDisclosure(false);
  const { state: authState } = useAuth();
  const { selectedGuildId } = useGuildContext();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("dark");
  const isDark = colorScheme === "dark";

  useEffect(() => {
    if (AUTH_PAGES.has(activePage) && authState !== "authenticated") {
      setActivePage("home");
    }
  }, [activePage, authState]);

  useEffect(() => {
    if (
      authState === "authenticated" &&
      !selectedGuildId &&
      AUTH_PAGES.has(activePage) &&
      activePage !== "select-server"
    ) {
      setPendingPage(activePage);
      setActivePage("select-server");
    }
  }, [activePage, authState, selectedGuildId]);

  useEffect(() => {
    if (
      authState === "authenticated" &&
      !selectedGuildId &&
      activePage === "home"
    ) {
      setPendingPage(null);
      setActivePage("select-server");
    }
  }, [activePage, authState, selectedGuildId]);

  const handleNavigate = (value: PageKey) => {
    if (AUTH_PAGES.has(value) && authState !== "authenticated") {
      setActivePage("home");
      return;
    }
    if (
      authState === "authenticated" &&
      !selectedGuildId &&
      AUTH_PAGES.has(value) &&
      value !== "select-server"
    ) {
      setPendingPage(value);
      setActivePage("select-server");
      return;
    }
    setActivePage(value);
    navbarHandlers.close();
  };

  const handleServerSelected = () => {
    if (pendingPage && pendingPage !== "select-server") {
      setActivePage(pendingPage);
      setPendingPage(null);
      return;
    }
    setActivePage("library");
  };

  const showNavbar = authState === "authenticated";

  return (
    <AppShell
      padding={0}
      header={{ height: 72 }}
      navbar={
        showNavbar
          ? {
              width: 300,
              breakpoint: "sm",
              collapsed: { mobile: !navbarOpened },
            }
          : undefined
      }
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
          showNavbarToggle={showNavbar}
          navbarOpened={navbarOpened}
          onNavbarToggle={navbarHandlers.toggle}
        />
      </AppShell.Header>
      {showNavbar ? (
        <AppShell.Navbar p={0}>
          <SiteNavbar
            activePage={activePage}
            onNavigate={handleNavigate}
            onClose={navbarHandlers.close}
          />
        </AppShell.Navbar>
      ) : null}
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
            {activePage === "home" && <Home />}
            {activePage === "select-server" && (
              <ServerSelect onContinue={handleServerSelected} />
            )}
            {activePage === "library" && <Library />}
            {activePage === "ask" && <Ask />}
            {activePage === "billing" && (
              <Billing onRequireAuth={() => setActivePage("home")} />
            )}
            {activePage === "settings" && <Settings />}
          </Container>
          <SiteFooter />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

function App() {
  return (
    <GuildProvider>
      <AppShellContent />
    </GuildProvider>
  );
}

export default App;
