import { Box, Group, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { uiLinks, uiTypography } from "../uiTokens";

type SiteHeaderLogoProps = {
  isMobile: boolean;
  isDark: boolean;
};

export function SiteHeaderLogo({ isMobile, isDark }: SiteHeaderLogoProps) {
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

export default SiteHeaderLogo;
