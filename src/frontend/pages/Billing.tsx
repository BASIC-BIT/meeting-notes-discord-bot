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
import { useAuth } from "../contexts/AuthContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import PricingCard from "../components/PricingCard";

type BillingMe = {
  billingEnabled: boolean;
  stripeMode: string;
  tier: "free" | "basic" | "pro";
  status: string;
  nextBillingDate: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  upgradeUrl: string | null;
  portalUrl: string | null;
  guildId?: string;
};

type PlanTier = "free" | "basic" | "pro";

type Benefit = {
  label: string;
  values: Record<PlanTier, string>;
};

const BENEFITS: Benefit[] = [
  {
    label: "Recording time per week (per server)",
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

export function Billing({ onRequireAuth }: { onRequireAuth?: () => void }) {
  const [data, setData] = useState<BillingMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPlans, setShowPlans] = useState(false);
  const { selectedGuildId, guilds, loading: guildLoading } = useGuildContext();
  const { state: authState } = useAuth();
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";

  useEffect(() => {
    let mounted = true;
    const loadBilling = async () => {
      try {
        if (!selectedGuildId) {
          setData(null);
          setLoading(false);
          return;
        }
        const res = await fetch(`/api/billing/me?guildId=${selectedGuildId}`, {
          credentials: "include",
        });
        if (res.status === 401) {
          setError("auth");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as BillingMe;
        if (mounted) {
          setData(body);
          setLoading(false);
        }
      } catch (err) {
        console.error("Billing fetch error", err);
        if (mounted) {
          setError("Unable to load billing status.");
          setLoading(false);
        }
      }
    };

    void loadBilling();
    return () => {
      mounted = false;
    };
  }, [selectedGuildId]);

  const serverName = useMemo(
    () =>
      guilds.find((g) => g.id === selectedGuildId)?.name || "Unknown server",
    [guilds, selectedGuildId],
  );

  const isUnauthenticated = authState === "unauthenticated" || error === "auth";
  useEffect(() => {
    if (isUnauthenticated && onRequireAuth) {
      onRequireAuth();
    }
  }, [isUnauthenticated, onRequireAuth]);

  if (isUnauthenticated) {
    return null;
  }

  if (loading || guildLoading) {
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
          Billing is not enabled in this environment. Stripe mode:{" "}
          {data.stripeMode}
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
      const res = await fetch(
        `/api/billing/checkout?guildId=${selectedGuildId}`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { url?: string };
      if (body.url) {
        window.location.href = body.url;
      } else {
        throw new Error("No checkout url returned");
      }
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
      const res = await fetch(
        `/api/billing/portal?guildId=${selectedGuildId}`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { url?: string };
      if (body.url) {
        window.location.href = body.url;
      } else {
        throw new Error("No portal url returned");
      }
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
    <Stack gap="xl">
      <PageHeader
        title="Billing"
        description="Manage subscriptions for the current server. Billing is per server."
      />

      <Surface
        p="xl"
        style={{
          backgroundImage: isDark
            ? "linear-gradient(135deg, rgba(42, 46, 68, 0.8), rgba(30, 30, 40, 0.6))"
            : "linear-gradient(135deg, rgba(94, 100, 242, 0.08), rgba(139, 92, 246, 0.06))",
        }}
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="md">
            <Stack gap="xs">
              <Group gap="sm">
                <ThemeIcon color="brand" variant="light" radius="md">
                  <IconCreditCard size={18} />
                </ThemeIcon>
                <Text fw={600}>Current plan</Text>
              </Group>
              <Group gap="sm" align="center">
                <Text size="lg" fw={700}>
                  {data.tier === "free"
                    ? "Free"
                    : data.tier === "pro"
                      ? "Pro"
                      : "Basic"}
                </Text>
                <Badge color={data.tier === "free" ? "gray" : "brand"}>
                  {statusLabel}
                </Badge>
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
                  onClick={data.tier === "free" ? handleCheckout : handlePortal}
                >
                  {data.tier === "free" ? "Upgrade to Basic" : "Manage billing"}
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                Billing is per server. Changes apply immediately.
              </Text>
            </Stack>
          </Stack>

          <Stack gap="xs">
            <Text fw={600}>Included in this plan</Text>
            <List
              spacing="xs"
              size="sm"
              icon={
                <ThemeIcon color="brand" radius="xl" size={20}>
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

      <Surface
        p="lg"
        tone={showPlans ? "default" : "soft"}
        onClick={!showPlans ? () => setShowPlans(true) : undefined}
        style={
          !showPlans
            ? {
                cursor: "pointer",
                borderColor: "var(--mantine-color-brand-6)",
              }
            : undefined
        }
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
                badge={data.tier === "free" ? "Current plan" : undefined}
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
                borderColor="var(--mantine-color-cyan-5)"
                borderWidth={2}
              />
            </SimpleGrid>
          </Collapse>
        </Stack>
      </Surface>
    </Stack>
  );
}

export default Billing;
