import {
  ActionIcon,
  Box,
  Button,
  Container,
  Group,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconMenu2,
  IconMoonStars,
  IconSun,
  IconBrandGithub,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import { uiLinks, uiTypography } from "../uiTokens";

type SiteHeaderProps = {
  showNavbarToggle?: boolean;
  navbarOpened: boolean;
  onNavbarToggle: () => void;
  context?: "marketing" | "portal" | "portal-select";
};

type AuthState = ReturnType<typeof useAuth>["state"];

type HeaderLogoProps = {
  isMobile: boolean;
  isDark: boolean;
};

function HeaderLogo({ isMobile, isDark }: HeaderLogoProps) {
  return (
    <Link to="/" style={uiLinks.plain} data-testid="site-logo">
      <Group gap="sm" align="center" wrap="nowrap">
        <Box
          component="img"
          src="/meeting_notes_original_logo.png"
          alt="Chronote logo"
          style={{ width: 40, height: 40 }}
        />
        <Text
          size={isMobile ? "lg" : "xl"}
          c={isDark ? "white" : "dark.9"}
          style={uiTypography.logo}
        >
          Chronote
        </Text>
      </Group>
    </Link>
  );
}

type AdminCtaProps = {
  isSuperAdmin: boolean;
  isMobile: boolean;
};

function AdminCta({ isSuperAdmin, isMobile }: AdminCtaProps) {
  if (!isSuperAdmin) return null;
  return (
    <Button
      component={Link}
      to="/admin"
      variant="outline"
      color="gray"
      size={isMobile ? "xs" : "sm"}
      data-testid="admin-cta"
    >
      Admin
    </Button>
  );
}

type PortalCtaProps = {
  showPortalCta: boolean;
  authState: AuthState;
  portalLabel: string;
  loginUrl: string;
  loading: boolean;
  isMobile: boolean;
};

function PortalCtaButton({
  showPortalCta,
  authState,
  portalLabel,
  loginUrl,
  loading,
  isMobile,
}: PortalCtaProps) {
  if (!showPortalCta) return null;
  const sharedProps = {
    variant: "light" as const,
    color: "brand" as const,
    size: isMobile ? "xs" : "sm",
    "data-testid": "portal-cta",
  };
  if (authState === "authenticated") {
    return (
      <Button component={Link} to="/portal/select-server" {...sharedProps}>
        {portalLabel}
      </Button>
    );
  }
  return (
    <Button component="a" href={loginUrl} disabled={loading} {...sharedProps}>
      {portalLabel}
    </Button>
  );
}

type GithubLinkProps = {
  showGithubLink: boolean;
};

function GithubLink({ showGithubLink }: GithubLinkProps) {
  if (!showGithubLink) return null;
  return (
    <Tooltip label="GitHub">
      <ActionIcon
        component="a"
        href="https://github.com/Chronote-gg/chronote"
        target="_blank"
        rel="noreferrer"
        variant="outline"
        size="lg"
        aria-label="GitHub repository"
      >
        <IconBrandGithub size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

type ThemeToggleProps = {
  isDark: boolean;
  onToggle: () => void;
};

function ThemeToggle({ isDark, onToggle }: ThemeToggleProps) {
  return (
    <Tooltip label={isDark ? "Switch to light mode" : "Switch to dark mode"}>
      <ActionIcon
        variant="outline"
        size="lg"
        onClick={onToggle}
        aria-label="Toggle color scheme"
        data-testid="theme-toggle"
      >
        {isDark ? <IconSun size={18} /> : <IconMoonStars size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

type HeaderActionsProps = {
  isSuperAdmin: boolean;
  showPortalCta: boolean;
  authState: AuthState;
  portalLabel: string;
  loginUrl: string;
  loading: boolean;
  showGithubLink: boolean;
  isMobile: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
};

function HeaderActions({
  isSuperAdmin,
  showPortalCta,
  authState,
  portalLabel,
  loginUrl,
  loading,
  showGithubLink,
  isMobile,
  isDark,
  onToggleTheme,
}: HeaderActionsProps) {
  return (
    <Group gap="sm" align="center" wrap="nowrap">
      <AdminCta isSuperAdmin={isSuperAdmin} isMobile={isMobile} />
      <PortalCtaButton
        showPortalCta={showPortalCta}
        authState={authState}
        portalLabel={portalLabel}
        loginUrl={loginUrl}
        loading={loading}
        isMobile={isMobile}
      />
      <GithubLink showGithubLink={showGithubLink} />
      <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
    </Group>
  );
}

type PortalHeaderShellProps = {
  showNavbarToggle: boolean;
  navbarOpened: boolean;
  onNavbarToggle: () => void;
  logo: ReactNode;
  rightControls: ReactNode;
  headerPaddingRight: string;
};

function PortalHeaderShell({
  showNavbarToggle,
  navbarOpened,
  onNavbarToggle,
  logo,
  rightControls,
  headerPaddingRight,
}: PortalHeaderShellProps) {
  return (
    <Box
      h="100%"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
        alignItems: "center",
      }}
    >
      <Box>
        {showNavbarToggle ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            onClick={onNavbarToggle}
            hiddenFrom="sm"
            aria-label={navbarOpened ? "Close navigation" : "Open navigation"}
          >
            <IconMenu2 size={18} />
          </ActionIcon>
        ) : null}
      </Box>
      <Box style={{ justifySelf: "center" }}>{logo}</Box>
      <Box style={{ justifySelf: "end", paddingRight: headerPaddingRight }}>
        {rightControls}
      </Box>
    </Box>
  );
}

export function SiteHeader({
  showNavbarToggle = true,
  navbarOpened,
  onNavbarToggle,
  context = "marketing",
}: SiteHeaderProps) {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const { toggleColorScheme } = useMantineColorScheme({
    keepTransitions: true,
  });
  const computedScheme = useComputedColorScheme("dark");
  const isDark = computedScheme === "dark";
  const { state: authState, loginUrl, loading, user } = useAuth();

  const showPortalCta = context !== "portal-select";
  const showGithubLink = true;
  const isPortalLayout = context !== "marketing";
  const portalLabel =
    authState === "authenticated" && context === "portal"
      ? "Switch server"
      : "Open portal";
  const isSuperAdmin =
    authState === "authenticated" && Boolean(user?.isSuperAdmin);
  const headerPaddingRight = isMobile ? theme.spacing.xs : theme.spacing.sm;

  const logo = <HeaderLogo isMobile={isMobile} isDark={isDark} />;
  const rightControls = (
    <HeaderActions
      isSuperAdmin={isSuperAdmin}
      showPortalCta={showPortalCta}
      authState={authState}
      portalLabel={portalLabel}
      loginUrl={loginUrl}
      loading={loading}
      showGithubLink={showGithubLink}
      isMobile={isMobile}
      isDark={isDark}
      onToggleTheme={toggleColorScheme}
    />
  );

  if (isPortalLayout) {
    return (
      <PortalHeaderShell
        showNavbarToggle={showNavbarToggle}
        navbarOpened={navbarOpened}
        onNavbarToggle={onNavbarToggle}
        logo={logo}
        rightControls={rightControls}
        headerPaddingRight={headerPaddingRight}
      />
    );
  }

  return (
    <Container size="xl" h="100%">
      <Group h="100%" justify="space-between" wrap="nowrap">
        {logo}
        {rightControls}
      </Group>
    </Container>
  );
}

export default SiteHeader;
