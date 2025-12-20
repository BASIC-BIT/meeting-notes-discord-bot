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
import { useAuth } from "../contexts/AuthContext";

type SiteHeaderProps = {
  showNavbarToggle?: boolean;
  navbarOpened: boolean;
  onNavbarToggle: () => void;
};

export function SiteHeader({
  showNavbarToggle = true,
  navbarOpened,
  onNavbarToggle,
}: SiteHeaderProps) {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const { toggleColorScheme } = useMantineColorScheme();
  const computedScheme = useComputedColorScheme("dark");
  const isDark = computedScheme === "dark";
  const { state: authState, loginUrl, loading } = useAuth();

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
          <ThemeIcon
            variant="gradient"
            gradient={{ from: "brand", to: "violet" }}
            radius="md"
            size={34}
          >
            <IconTimeline size={18} />
          </ThemeIcon>
          <Text
            fw={850}
            size={isMobile ? "lg" : "xl"}
            style={{
              letterSpacing: "-0.02em",
              color: isDark ? theme.white : theme.colors.dark[9],
              lineHeight: 1,
            }}
          >
            Chronote
          </Text>
        </Group>

        <Group gap="sm" align="center" wrap="nowrap">
          {authState === "unauthenticated" ? (
            <Button
              component="a"
              href={loginUrl}
              variant="light"
              color="brand"
              size={isMobile ? "xs" : "sm"}
              disabled={loading}
            >
              Connect Discord
            </Button>
          ) : null}
          <Tooltip
            label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <ActionIcon
              variant="outline"
              radius="md"
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
