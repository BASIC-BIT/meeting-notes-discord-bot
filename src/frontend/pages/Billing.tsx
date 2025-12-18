import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useGuildContext } from "../contexts/GuildContext";
import { useAuth } from "../contexts/AuthContext";
import AuthBanner from "../components/AuthBanner";

type BillingMe = {
  billingEnabled: boolean;
  stripeMode: string;
  tier: "free" | "basic";
  status: string;
  nextBillingDate: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  upgradeUrl: string | null;
  portalUrl: string | null;
  guildId?: string;
};

const BENEFITS = [
  { label: "Meetings per day (per guild)", free: "3", basic: "Unlimited" },
  { label: "Max meeting duration", free: "90 minutes", basic: "2 hours" },
  { label: "/ask history depth", free: "5 meetings", basic: "25 meetings" },
  { label: "Live voice replies", free: "No", basic: "Yes" },
  { label: "Image generation", free: "No", basic: "Yes" },
];

export function Billing() {
  const [data, setData] = useState<BillingMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { selectedGuildId, guilds, loading: guildLoading } = useGuildContext();
  const { state: authState } = useAuth();

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

  const guildName = useMemo(
    () => guilds.find((g) => g.id === selectedGuildId)?.name || "Unknown guild",
    [guilds, selectedGuildId],
  );

  if (authState === "unauthenticated" || error === "auth") {
    return (
      <Stack gap="md">
        <Title order={2}>Billing</Title>
        <AuthBanner message="Connect Discord to view billing for your servers." />
      </Stack>
    );
  }

  if (loading || guildLoading) return <p>Loading billing info…</p>;
  if (error) return <p>{error}</p>;
  if (!data) return <p>No data.</p>;

  if (!data.billingEnabled) {
    return (
      <Stack gap="md">
        <Title order={2}>Billing</Title>
        <Alert title="Billing disabled" color="yellow">
          Billing is not enabled in this environment. Stripe mode:{" "}
          {data.stripeMode}
        </Alert>
      </Stack>
    );
  }

  const statusLine = data.nextBillingDate
    ? `${data.status} — next billing: ${new Date(
        data.nextBillingDate,
      ).toLocaleString()}`
    : data.status;

  return (
    <Stack gap="md">
      <Title order={2}>Billing</Title>

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <Text size="lg" fw={700}>
                {data.tier === "free" ? "Free" : "Basic"} plan
              </Text>
              <Badge color={data.tier === "free" ? "gray" : "indigo"}>
                {data.status}
              </Badge>
            </Group>
            <Badge variant="light" color="gray">
              Stripe mode: {data.stripeMode}
            </Badge>
          </Group>
          <Text c="dimmed" size="sm">
            {statusLine}
          </Text>
          <Group gap="sm">
            <Button
              color="indigo"
              variant="filled"
              disabled={!selectedGuildId}
              onClick={async () => {
                try {
                  const res = await fetch(
                    `/api/billing/checkout?guildId=${selectedGuildId}`,
                    { method: "POST", credentials: "include" },
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
              }}
            >
              {data.tier === "free" ? "Upgrade to Basic" : "Upgrade / Change"}
            </Button>
            <Button
              variant="outline"
              disabled={!selectedGuildId}
              onClick={async () => {
                try {
                  const res = await fetch(
                    `/api/billing/portal?guildId=${selectedGuildId}`,
                    { method: "POST", credentials: "include" },
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
              }}
            >
              Manage Billing
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Guild: {guildName}
          </Text>
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="lg" shadow="xs">
        <Title order={4} mb="sm">
          Plans
        </Title>
        <Table verticalSpacing="xs">
          <thead>
            <tr>
              <th>Benefit</th>
              <th>Free</th>
              <th>Basic</th>
            </tr>
          </thead>
          <tbody>
            {BENEFITS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.free}</td>
                <td>{row.basic}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </Stack>
  );
}

export default Billing;
