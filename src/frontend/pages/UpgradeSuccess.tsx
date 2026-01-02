import {
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCreditCard,
  IconConfetti,
  IconSparkles,
  IconTicket,
} from "@tabler/icons-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import Surface from "../components/Surface";
import { useAuth } from "../contexts/AuthContext";
import { useGuildContext } from "../contexts/GuildContext";
import { buildApiUrl } from "../services/apiClient";
import { heroBackground, uiTypography } from "../uiTokens";

export default function UpgradeSuccess() {
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  const { state: authState, loading: authLoading } = useAuth();
  const { guilds } = useGuildContext();
  const navigate = useNavigate({ from: "/marketing/upgrade/success" });
  const search = useSearch({ from: "/marketing/upgrade/success" });
  const promoCode = search.promo?.trim() ?? "";
  const serverId = search.serverId?.trim() ?? "";
  const serverName =
    guilds.find((guild) => guild.id === serverId)?.name ?? "your server";

  const redirectTarget = serverId
    ? `${window.location.origin}/portal/server/${serverId}/library`
    : `${window.location.origin}/portal/select-server`;
  const loginUrl = `${buildApiUrl("/auth/discord")}?redirect=${encodeURIComponent(
    redirectTarget,
  )}`;

  const handleOpenPortal = () => {
    if (serverId) {
      navigate({
        to: "/portal/server/$serverId/library",
        params: { serverId },
      });
      return;
    }
    navigate({ to: "/portal/select-server" });
  };

  const handleManageBilling = () => {
    if (serverId) {
      navigate({
        to: "/portal/server/$serverId/billing",
        params: { serverId },
      });
      return;
    }
    navigate({ to: "/portal/select-server" });
  };

  return (
    <Stack gap="xl">
      <Surface
        p={{ base: "lg", md: "xl" }}
        tone="raised"
        style={{ backgroundImage: heroBackground(isDark) }}
      >
        <Stack gap="md">
          <Text size="xs" c="dimmed" style={uiTypography.heroKicker}>
            Upgrade successful
          </Text>
          <Group gap="sm" align="center">
            <ThemeIcon color="brand" variant="light">
              <IconConfetti size={18} />
            </ThemeIcon>
            <Title order={2}>Upgrade complete.</Title>
          </Group>
          <Text c="dimmed" size="sm">
            {serverId
              ? `Your subscription is active for ${serverName}.`
              : "Your subscription is active and ready to power your next meeting."}
          </Text>
          {promoCode ? (
            <Group gap="xs">
              <ThemeIcon color="brand" variant="light" size="sm">
                <IconTicket size={14} />
              </ThemeIcon>
              <Text size="sm" fw={600}>
                Promo applied
              </Text>
              <Text size="sm" c="dimmed">
                {promoCode}
              </Text>
            </Group>
          ) : null}
          <Group gap="sm" wrap="wrap">
            {authState === "authenticated" ? (
              <Button
                rightSection={<IconArrowRight size={16} />}
                onClick={handleOpenPortal}
              >
                {serverId ? `Open ${serverName}` : "Open portal"}
              </Button>
            ) : (
              <Button
                component="a"
                href={loginUrl}
                rightSection={<IconArrowRight size={16} />}
                loading={authLoading}
              >
                Connect Discord
              </Button>
            )}
            {authState === "authenticated" ? (
              <Button
                variant="light"
                onClick={handleManageBilling}
                rightSection={<IconSparkles size={16} />}
              >
                Manage billing
              </Button>
            ) : (
              <Button
                variant="light"
                component="a"
                href="/"
                rightSection={<IconSparkles size={16} />}
              >
                Back to homepage
              </Button>
            )}
          </Group>
        </Stack>
      </Surface>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        <Surface p="lg" tone="soft">
          <Stack gap="sm">
            <ThemeIcon color="brand" variant="light">
              <IconSparkles size={18} />
            </ThemeIcon>
            <Text fw={600}>Share the upgrade</Text>
            <Text size="sm" c="dimmed">
              Let your team know the upgraded plan is active and ready.
            </Text>
          </Stack>
        </Surface>
        <Surface p="lg" tone="soft">
          <Stack gap="sm">
            <ThemeIcon color="brand" variant="light">
              <IconCreditCard size={18} />
            </ThemeIcon>
            <Text fw={600}>Manage billing anytime</Text>
            <Text size="sm" c="dimmed">
              Update payment details, invoices, and plan settings from the
              portal.
            </Text>
          </Stack>
        </Surface>
        <Surface p="lg" tone="soft">
          <Stack gap="sm">
            <ThemeIcon color="brand" variant="light">
              <IconSparkles size={18} />
            </ThemeIcon>
            <Text fw={600}>See the new limits</Text>
            <Text size="sm" c="dimmed">
              Start a meeting to see the upgraded limits and new features in
              action.
            </Text>
          </Stack>
        </Surface>
      </SimpleGrid>
    </Stack>
  );
}
