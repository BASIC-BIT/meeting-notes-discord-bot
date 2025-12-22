import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Collapse,
  Divider,
  Group,
  List,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { IconCheck, IconCreditCard } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import PricingCard from "../components/PricingCard";
import { trpc } from "../services/trpc";
import { uiBorders, uiColors, uiGradients } from "../uiTokens";

type PlanTier = "free" | "basic" | "pro";

type Benefit = {
  label: string;
  values: Record<PlanTier, string>;
};

const BENEFITS: Benefit[] = [
  {
    label: "Recording time per week",
    values: { free: "4 hours", basic: "20 hours", pro: "Unlimited" },
  },
  {
    label: "Max meeting length",
    values: {
      free: "90 minutes",
      basic: "2 hours (8 hours coming soon)",
      pro: "2 hours (8 hours coming soon)",
    },
  },
  {
    label: "Retention window",
    values: { free: "30 days", basic: "Extended", pro: "Unlimited" },
  },
  {
    label: "Ask history",
    values: {
      free: "Recent meetings",
      basic: "Longer history",
      pro: "Full retention",
    },
  },
  {
    label: "Live voice mode",
    values: { free: "No", basic: "Yes", pro: "Yes" },
  },
  {
    label: "Priority features",
    values: { free: "—", basic: "—", pro: "Yes" },
  },
];

export function Billing() {
  const [showPlans, setShowPlans] = useState(false);
  const { selectedGuildId, guilds, loading: guildLoading } = useGuildContext();
  const billingQuery = trpc.billing.me.useQuery(
    { serverId: selectedGuildId ?? undefined },
    { enabled: Boolean(selectedGuildId) },
  );
  const checkoutMutation = trpc.billing.checkout.useMutation();
  const portalMutation = trpc.billing.portal.useMutation();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";

  const serverName = useMemo(
    () =>
      guilds.find((g) => g.id === selectedGuildId)?.name || "Unknown server",
    [guilds, selectedGuildId],
  );
  const data = billingQuery.data ?? null;
  const loading = billingQuery.isLoading || guildLoading;
  const error = billingQuery.error ? "Unable to load billing status." : null;
  const isPortalPending = portalMutation.isPending;
  const isFreeTier = data?.tier === "free";

  useEffect(() => {
    if (isFreeTier) {
      setShowPlans(true);
    }
  }, [isFreeTier]);

  if (loading) {
    return (
      <Center py="xl">
        <Stack gap="xs" align="center">
          <Loader color="brand" />
          <Text c="dimmed">Loading billing info...</Text>
        </Stack>
      </Center>
    );
  }
  if (error) return <Text c="red">{error}</Text>;
  if (!data) {
    return (
      <Surface p="xl">
        <Stack gap="sm">
          <Text fw={600}>Select a server to view billing</Text>
          <Text c="dimmed" size="sm">
            Choose a server in the sidebar to see its subscription status.
          </Text>
        </Stack>
      </Surface>
    );
  }

  if (!data.billingEnabled) {
    return (
      <Stack gap="lg">
        <PageHeader
          title="Billing"
          description="Billing is disabled in this environment."
        />
        <Alert title="Billing disabled" color="yellow">
          Billing is not enabled in this environment.
        </Alert>
      </Stack>
    );
  }

  const statusLabel = data.status
    .split(/[_-\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const statusLine = data.nextBillingDate
    ? `${statusLabel} • next billing ${new Date(
        data.nextBillingDate,
      ).toLocaleDateString()}`
    : statusLabel;

  const handleCheckout = async () => {
    try {
      if (!selectedGuildId) return;
      const body = await checkoutMutation.mutateAsync({
        serverId: selectedGuildId,
      });
      window.location.href = body.url;
    } catch (err) {
      console.error(err);
      notifications.show({
        color: "red",
        title: "Checkout failed",
        message: "Could not start checkout. Please try again.",
      });
    }
  };

  const handlePortal = async () => {
    try {
      if (!selectedGuildId) return;
      const body = await portalMutation.mutateAsync({
        serverId: selectedGuildId,
      });
      window.location.href = body.url;
    } catch (err) {
      console.error(err);
      notifications.show({
        color: "red",
        title: "Billing portal failed",
        message: "Could not open billing portal. Please try again.",
      });
    }
  };

  return (
    <Stack gap="xl" w="100%" style={{ width: "100%" }}>
      <PageHeader
        title="Billing"
        description="Manage subscriptions for the current server."
      />

      {isFreeTier ? (
        <Surface
          p="xl"
          style={{
            backgroundImage: uiGradients.billingPanel(isDark),
          }}
        >
          <Stack gap="sm">
            <Group gap="sm">
              <ThemeIcon color="brand" variant="light">
                <IconCreditCard size={18} />
              </ThemeIcon>
              <Text fw={600}>You’re on the Free plan</Text>
            </Group>
            <Text c="dimmed" size="sm">
              Unlock deeper recall, longer sessions, and higher retention by
              upgrading below.
            </Text>
            <Text size="sm" c="dimmed">
              Server: {serverName}
            </Text>
          </Stack>
        </Surface>
      ) : (
        <Surface
          p="xl"
          style={{
            backgroundImage: uiGradients.billingPanel(isDark),
          }}
        >
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
            <Stack gap="md">
              <Stack gap="xs">
                <Group gap="sm">
                  <ThemeIcon color="brand" variant="light">
                    <IconCreditCard size={18} />
                  </ThemeIcon>
                  <Text fw={600}>Current plan</Text>
                </Group>
                <Group gap="sm" align="center">
                  <Text size="lg" fw={700}>
                    {data.tier === "pro" ? "Pro" : "Basic"}
                  </Text>
                  <Badge color="brand">{statusLabel}</Badge>
                </Group>
                <Text c="dimmed" size="sm">
                  {statusLine}
                </Text>
                <Text size="sm" c="dimmed">
                  Server: {serverName}
                </Text>
              </Stack>

              <Divider />

              <Stack gap="xs">
                <Text fw={600}>Actions</Text>
                <Group gap="sm" wrap="wrap">
                  <Button
                    variant="gradient"
                    gradient={{ from: "brand", to: "violet" }}
                    disabled={!selectedGuildId}
                    loading={isPortalPending}
                    onClick={handlePortal}
                  >
                    Manage billing
                  </Button>
                </Group>
                <Text size="xs" c="dimmed">
                  Changes apply immediately.
                </Text>
              </Stack>
            </Stack>

            <Stack gap="xs">
              <Text fw={600}>Included in this plan</Text>
              <List
                spacing="xs"
                size="sm"
                icon={
                  <ThemeIcon color="brand" size={20}>
                    <IconCheck size={12} />
                  </ThemeIcon>
                }
              >
                {BENEFITS.map((benefit) => (
                  <List.Item key={benefit.label}>
                    {benefit.label}: {benefit.values[data.tier]}
                  </List.Item>
                ))}
              </List>
            </Stack>
          </SimpleGrid>
        </Surface>
      )}

      <Surface
        p="lg"
        tone={showPlans ? "default" : "soft"}
        onClick={!showPlans ? () => setShowPlans(true) : undefined}
        style={{
          width: "100%",
          ...(showPlans
            ? {}
            : {
                cursor: "pointer",
                borderColor: uiColors.highlightBorder,
              }),
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm" align="center">
              <Title order={4}>Plans</Title>
            </Group>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => setShowPlans((prev) => !prev)}
            >
              {showPlans ? "Hide plans" : "Compare plans"}
            </Button>
          </Group>
          {!showPlans ? (
            <Text size="sm" c="dimmed">
              Compare plan details when you are ready to change tiers.
            </Text>
          ) : null}
          <Collapse in={showPlans}>
            <Divider my="sm" />
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
              <PricingCard
                name="Free"
                price="$0"
                description="Lightweight coverage for smaller servers."
                features={[
                  "Up to 4 hours per week",
                  "Up to 90 minutes per meeting",
                  "Ask across recent meetings",
                  "Notes, tags, and summaries",
                ]}
                cta={data.tier === "free" ? "Current plan" : "Available"}
                ctaDisabled={data.tier !== "free"}
                ctaProps={{
                  variant: data.tier === "free" ? "light" : "outline",
                }}
                badge={data.tier === "free" ? "Current plan" : "Free forever"}
              />
              <PricingCard
                name="Basic"
                price="$12 / mo"
                description="Unlock longer sessions and deeper recall."
                features={[
                  "Up to 20 hours per week",
                  "Up to 2 hours per meeting (8 hours coming soon)",
                  "Ask across longer history",
                  "Live voice mode",
                ]}
                cta={
                  data.tier === "basic" ? "Current plan" : "Upgrade to Basic"
                }
                ctaDisabled={data.tier === "basic"}
                ctaProps={
                  data.tier === "basic"
                    ? { variant: "light" }
                    : { onClick: handleCheckout }
                }
                highlighted
                badge={data.tier === "basic" ? "Current plan" : "Best value"}
              />
              <PricingCard
                name="Pro"
                price="$29 / mo"
                description="Unlimited retention and deep server memory."
                features={[
                  "Unlimited retention",
                  "Unlimited recording time",
                  "Ask across full retention",
                  "Up to 2 hours per meeting (8 hours coming soon)",
                  "Priority features + support",
                ]}
                cta={data.tier === "pro" ? "Current plan" : "Upgrade to Pro"}
                ctaDisabled
                badge={
                  data.tier === "pro" ? "Current plan" : "Unlimited meetings"
                }
                tone="soft"
                borderColor={uiColors.accentBorder}
                borderWidth={uiBorders.accentWidth}
              />
            </SimpleGrid>
          </Collapse>
        </Stack>
      </Surface>
    </Stack>
  );
}

export default Billing;
