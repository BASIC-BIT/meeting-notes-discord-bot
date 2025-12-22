import {
  ActionIcon,
  Button,
  Container,
  Group,
  Text,
  ThemeIcon,
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
  IconTimeline,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "../contexts/AuthContext";
import { uiLinks, uiTypography } from "../uiTokens";

type SiteHeaderProps = {
  showNavbarToggle?: boolean;
  navbarOpened: boolean;
  onNavbarToggle: () => void;
  context?: "marketing" | "portal" | "portal-select";
};

export function SiteHeader({
  showNavbarToggle = true,
  navbarOpened,
  onNavbarToggle,
  context = "marketing",
}: SiteHeaderProps) {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const { toggleColorScheme } = useMantineColorScheme();
  const computedScheme = useComputedColorScheme("dark");
  const isDark = computedScheme === "dark";
  const { state: authState, loginUrl, loading } = useAuth();

  const showPortalCta = context !== "portal-select";
  const portalLabel =
    authState === "authenticated" && context === "portal"
      ? "Switch server"
      : "Open portal";

  return (
    <Container size="xl" h="100%">
      <Group h="100%" justify="space-between" wrap="nowrap">
        <Group gap="sm" align="center" wrap="nowrap">
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
          <Link to="/" style={uiLinks.plain}>
            <Group gap="sm" align="center" wrap="nowrap">
              <ThemeIcon
                variant="gradient"
                gradient={{ from: "brand", to: "violet" }}
                size={34}
              >
                <IconTimeline size={18} />
              </ThemeIcon>
              <Text
                size={isMobile ? "lg" : "xl"}
                c={isDark ? "white" : "dark.9"}
                style={uiTypography.logo}
              >
                Chronote
              </Text>
            </Group>
          </Link>
        </Group>

        <Group gap="sm" align="center" wrap="nowrap">
          {showPortalCta ? (
            authState === "authenticated" ? (
              <Button
                component={Link}
                to="/portal/select-server"
                variant="light"
                color="brand"
                size={isMobile ? "xs" : "sm"}
              >
                {portalLabel}
              </Button>
            ) : (
              <Button
                component="a"
                href={loginUrl}
                variant="light"
                color="brand"
                size={isMobile ? "xs" : "sm"}
                disabled={loading}
              >
                {portalLabel}
              </Button>
            )
          ) : null}
          <Tooltip
            label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <ActionIcon
              variant="outline"
              size="lg"
              onClick={() => toggleColorScheme()}
              aria-label="Toggle color scheme"
            >
              {isDark ? <IconSun size={18} /> : <IconMoonStars size={18} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Container>
  );
}

export default SiteHeader;
