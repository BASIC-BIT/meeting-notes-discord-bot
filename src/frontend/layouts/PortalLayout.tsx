import {
  AppShell,
  Center,
  Container,
  Loader,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import SiteNavbar from "../components/SiteNavbar";
import { useAuth } from "../contexts/AuthContext";
import { useGuildContext } from "../contexts/GuildContext";
import {
  appBackground,
  pagePaddingX,
  pagePaddingY,
  pagePaddingYCompact,
  portalBackground,
  shellBorder,
  shellFooterBackground,
  shellHeaderBackground,
  shellHeights,
  shellShadow,
} from "../uiTokens";

export default function PortalLayout() {
  const [navbarOpened, navbarHandlers] = useDisclosure(false);
  const { state: authState, loading: authLoading } = useAuth();
  const { loading: guildLoading } = useGuildContext();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("dark");
  const isDark = colorScheme === "dark";
  const portalBackgroundImage = portalBackground(isDark);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const showNavbar = !pathname.startsWith("/portal/select-server");
  const useInnerScroll =
    pathname.startsWith("/portal/server/") && pathname.endsWith("/ask");

  if (authState === "unauthenticated") {
    return <Navigate to="/" />;
  }

  if (authState === "unknown" || authLoading || guildLoading) {
    return (
      <AppShell
        padding={0}
        header={{ height: shellHeights.header }}
        footer={{ height: shellHeights.footer }}
        style={{
          height: "100vh",
          overflow: "hidden",
          backgroundColor: appBackground(theme, isDark),
          backgroundImage: portalBackgroundImage,
        }}
        styles={{
          header: {
            borderBottom: shellBorder(theme, isDark),
            backgroundColor: shellHeaderBackground(isDark),
            backdropFilter: "blur(16px)",
            boxShadow: shellShadow(isDark),
          },
          main: {
            overflow: useInnerScroll ? "hidden" : "auto",
            height:
              "calc(100dvh - var(--app-shell-header-offset) - var(--app-shell-footer-offset))",
          },
          footer: {
            borderTop: shellBorder(theme, isDark),
            backgroundColor: shellFooterBackground(isDark),
            backdropFilter: "blur(16px)",
          },
        }}
      >
        <AppShell.Header p="md">
          <SiteHeader
            showNavbarToggle={false}
            navbarOpened={false}
            onNavbarToggle={() => {}}
            context={showNavbar ? "portal" : "portal-select"}
          />
        </AppShell.Header>
        <AppShell.Main>
          <Container
            size="xl"
            px={pagePaddingX}
            pt={pagePaddingY}
            pb={{
              base: useInnerScroll
                ? pagePaddingYCompact.base
                : pagePaddingY.base,
              md: useInnerScroll ? pagePaddingYCompact.md : pagePaddingY.md,
            }}
            style={{
              display: useInnerScroll ? "flex" : "block",
              flexDirection: useInnerScroll ? "column" : undefined,
              minHeight: 0,
              height: useInnerScroll ? "100%" : undefined,
            }}
          >
            <Center py="xl">
              <Stack gap="xs" align="center">
                <Loader color="brand" />
                <Text c="dimmed">Loading your portal...</Text>
              </Stack>
            </Center>
          </Container>
        </AppShell.Main>
        <AppShell.Footer>
          <SiteFooter variant="compact" />
        </AppShell.Footer>
      </AppShell>
    );
  }

  return (
    <AppShell
      padding={0}
      header={{ height: shellHeights.header }}
      footer={{ height: shellHeights.footer }}
      style={{
        height: "100vh",
        overflow: "hidden",
        backgroundColor: appBackground(theme, isDark),
        backgroundImage: portalBackgroundImage,
      }}
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
          borderBottom: shellBorder(theme, isDark),
          backgroundColor: shellHeaderBackground(isDark),
          backdropFilter: "blur(16px)",
          boxShadow: shellShadow(isDark),
        },
        main: {
          overflow: useInnerScroll ? "hidden" : "auto",
          height:
            "calc(100dvh - var(--app-shell-header-offset) - var(--app-shell-footer-offset))",
        },
        footer: {
          borderTop: shellBorder(theme, isDark),
          backgroundColor: shellFooterBackground(isDark),
          backdropFilter: "blur(16px)",
        },
      }}
    >
      <AppShell.Header p="md">
        <SiteHeader
          showNavbarToggle={showNavbar}
          navbarOpened={navbarOpened}
          onNavbarToggle={navbarHandlers.toggle}
          context={showNavbar ? "portal" : "portal-select"}
        />
      </AppShell.Header>
      {showNavbar ? (
        <AppShell.Navbar p={0}>
          <SiteNavbar onClose={navbarHandlers.close} pathname={pathname} />
        </AppShell.Navbar>
      ) : null}
      <AppShell.Main>
        <Container
          size="xl"
          px={pagePaddingX}
          pt={pagePaddingY}
          pb={{
            base: useInnerScroll ? pagePaddingYCompact.base : pagePaddingY.base,
            md: useInnerScroll ? pagePaddingYCompact.md : pagePaddingY.md,
          }}
          style={{
            display: useInnerScroll ? "flex" : "block",
            flexDirection: useInnerScroll ? "column" : undefined,
            minHeight: 0,
            height: useInnerScroll ? "100%" : undefined,
          }}
        >
          <Outlet />
        </Container>
      </AppShell.Main>
      <AppShell.Footer>
        <SiteFooter variant="compact" />
      </AppShell.Footer>
    </AppShell>
  );
}
