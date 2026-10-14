import { useIntroOfferExpiry } from "../hooks/useIntroOfferExpiry";
import {
  isTerminalStripeHistory,
  requiresStripeManagement,
} from "../utils/billingManagement";
import { useIntroOfferExposure } from "../hooks/useIntroOfferExposure";
import RecordingPlanContext from "../components/RecordingPlanContext";
import {
  resolveRecordingLimitContext,
  recordingLimitAnalytics,
  resolvePurchaseSource,
} from "../../utils/purchaseAnalytics";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
} from "react";
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
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconCheck, IconCreditCard } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { inferRouterInputs } from "@trpc/server";
import type { BasicIntroOffer, IntroOfferChoice } from "../../types/pricing";
import BasicIntroTerms from "../components/BasicIntroTerms";
import IntroPromotionChoice from "../components/IntroPromotionChoice";
import SubscriptionDetails from "../components/SubscriptionDetails";
import classes from "./UpgradeServerSelect.module.css";
import { useCheckoutAttempt } from "../hooks/useCheckoutAttempt";
import { useGuildContext } from "../contexts/GuildContext";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";
import PricingCard from "../components/PricingCard";
import { trpc } from "../services/trpc";
import { track, isDoNotTrackEnabled } from "../services/analytics";
import { showBillingError } from "../utils/billingErrorNotification";
import { uiBorders, uiColors } from "../uiTokens";
import type { inferRouterOutputs } from "@trpc/server";
import type { BillingInterval, PaidTier } from "../../types/pricing";
import type { AppRouter } from "../../trpc/router";
import {
  billingLabelForInterval,
  buildPaidPlanLookup,
  formatPlanPrice,
  introOfferPrice,
  resolveIntroOffer,
  resolvePaidPlan,
} from "../utils/pricing";

type PlanTier = "free" | "basic" | "pro";

type Benefit = {
  label: string;
  values: Record<PlanTier, string>;
};

type RouterOutput = inferRouterOutputs<AppRouter>;
type BillingData = RouterOutput["billing"]["me"];

type BillingUsage = NonNullable<BillingData["usage"]>;

type BillingShellProps = {
  children: ReactNode;
  description?: string;
};

type BillingBaseProps = {
  serverName: string;
  usage?: BillingUsage | null;
};

type BillingPaidProps = BillingBaseProps & {
  data: BillingData;
  statusLabel: string;
  statusLine: string;
  isPortalPending: boolean;
  canManage: boolean;
  onPortal: () => void;
  normalPrice: string | null;
};

type BillingPlansProps = {
  data: BillingData;
  interval: BillingInterval;
  onIntervalChange: (value: BillingInterval) => void;
  hasAnnualPlans: boolean;
  showPlans: boolean;
  onExpandPlans: () => void;
  onTogglePlans: () => void;
  onCheckout: (tier: PaidTier) => void;
  promoCode: string;
  onPromoCodeChange: (value: string) => void;
  basicPlan: ReturnType<typeof resolvePaidPlan>;
  proPlan: ReturnType<typeof resolvePaidPlan>;
  offer: BasicIntroOffer;
  offerChoice: IntroOfferChoice;
  onOfferChoiceChange: (choice: IntroOfferChoice) => void;
  busy: boolean;
  checkoutBlocked: boolean;
};

const DEFAULT_DESCRIPTION = "Manage subscriptions for the current server.";

const BENEFITS: Benefit[] = [
  {
    label: "Recording time per rolling week",
    values: { free: "4 hours", basic: "20 hours", pro: "No weekly limit" },
  },
  {
    label: "Max meeting length",
    values: {
      free: "90 minutes",
      basic: "2 hours",
      pro: "2 hours",
    },
  },
  {
    label: "Ask history",
    values: {
      free: "Up to 5 meetings",
      basic: "Up to 25 meetings",
      pro: "Up to 100 meetings",
    },
  },
  {
    label: "Live voice mode",
    values: { free: "No", basic: "Yes", pro: "Yes" },
  },
  {
    label: "Priority features",
    values: { free: "Not included", basic: "Not included", pro: "Yes" },
  },
];

const formatUsageMinutes = (minutes: number) => {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  }
  return `${minutes}m`;
};

const formatStatusLabel = (status: string) =>
  status
    .split(/[_-\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatStatusLine = (
  statusLabel: string,
  nextBillingDate?: string | null,
) =>
  nextBillingDate
    ? `${statusLabel} - next billing ${new Date(
        nextBillingDate,
      ).toLocaleDateString()}`
    : statusLabel;

const BillingShell = ({
  children,
  description = DEFAULT_DESCRIPTION,
}: BillingShellProps) => (
  <Stack gap="xl" w="100%" data-testid="billing-page">
    <PageHeader title="Billing" description={description} />
    {children}
  </Stack>
);

const BillingLoadingState = () => (
  <BillingShell>
    <Center py="xl">
      <Stack gap="xs" align="center">
        <Loader color="brand" />
        <Text c="dimmed">Loading billing info...</Text>
      </Stack>
    </Center>
  </BillingShell>
);

const BillingErrorState = ({ message }: { message: string }) => (
  <BillingShell>
    <Text c="red">{message}</Text>
  </BillingShell>
);

const BillingNoServerState = () => (
  <BillingShell>
    <Surface p="xl">
      <Stack gap="sm">
        <Text fw={600}>Select a server to view billing</Text>
        <Text c="dimmed" size="sm">
          Choose a server in the sidebar to see its subscription status.
        </Text>
      </Stack>
    </Surface>
  </BillingShell>
);

const BillingDisabledState = () => (
  <BillingShell description="Billing is disabled in this environment.">
    <Alert title="Billing disabled" color="yellow">
      Billing is not enabled in this environment.
    </Alert>
  </BillingShell>
);

const BillingUsageMeter = ({ usage }: { usage?: BillingUsage | null }) => {
  if (!usage?.limitMinutes || usage.limitMinutes <= 0) return null;
  const used = usage.usedMinutes ?? 0;
  const limit = usage.limitMinutes;
  const percent = Math.min(100, (used / limit) * 100);
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" c="dimmed">
          Usage (rolling 7 days)
        </Text>
        <Text size="sm" fw={600}>
          {formatUsageMinutes(used)} / {formatUsageMinutes(limit)}
        </Text>
      </Group>
      <Progress value={percent} color="brand" size="sm" />
    </Stack>
  );
};

const BillingFreePanel = ({ serverName, usage }: BillingBaseProps) => (
  <Surface p="xl" data-testid="billing-current-plan">
    <Stack gap="sm">
      <Group gap="sm">
        <ThemeIcon color="brand" variant="light">
          <IconCreditCard size={18} />
        </ThemeIcon>
        <Text fw={600}>Current plan</Text>
      </Group>
      <Text size="lg" fw={700}>
        Free
      </Text>
      <Text size="sm" c="dimmed">
        Server: {serverName}
      </Text>
      <BillingUsageMeter usage={usage} />
    </Stack>
  </Surface>
);

const BillingPaidPanel = ({
  data,
  serverName,
  statusLabel,
  statusLine,
  usage,
  isPortalPending,
  canManage,
  onPortal,
  normalPrice,
}: BillingPaidProps) => (
  <Surface p="xl" data-testid="billing-current-plan">
    {(() => {
      const isComped = data.billingSource === "manual_comp";
      const planName = formatStatusLabel(data.tier);
      const expiryLine = data.activeGrant?.expiresAt
        ? `Comp runs through ${new Date(
            data.activeGrant.expiresAt,
          ).toLocaleDateString()}.`
        : "No payment required.";
      return (
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
                  {planName}
                </Text>
                {(isComped || data.tier !== "free") && (
                  <Badge color={isComped ? "teal" : "brand"}>
                    {isComped ? "Comped by Chronote" : statusLabel}
                  </Badge>
                )}
              </Group>
              {isComped ? (
                <Stack gap={4}>
                  <Text c="var(--mantine-color-text)" size="sm">
                    Chronote has granted this server {planName} for free.{" "}
                    {normalPrice
                      ? `This is normally ${normalPrice}.`
                      : "Regular pricing is unavailable right now."}
                  </Text>
                  <Text c="dimmed" size="sm">
                    {expiryLine}
                  </Text>
                  {data.activeGrant?.publicNote ? (
                    <Text size="sm">{data.activeGrant.publicNote}</Text>
                  ) : null}
                </Stack>
              ) : data.tier !== "free" ? (
                <Text c="dimmed" size="sm">
                  {statusLine}
                </Text>
              ) : null}
              <Text size="sm" c="dimmed">
                Server: {serverName}
              </Text>
              {!isComped && (
                <SubscriptionDetails details={data.subscriptionDetails} />
              )}
              <BillingUsageMeter usage={usage} />
            </Stack>

            <Divider />

            <Stack gap="xs">
              <Text fw={600}>Actions</Text>
              {data.canManageBillingPortal ? (
                <Group gap="sm" wrap="wrap">
                  <Button
                    variant="filled"
                    disabled={!canManage}
                    loading={isPortalPending}
                    onClick={onPortal}
                    data-testid="billing-manage"
                  >
                    Manage billing
                  </Button>
                </Group>
              ) : null}
              <Text size="xs" c="dimmed">
                {isComped
                  ? "Use the plans below to start paying or upgrade when you're ready."
                  : "Review available changes in the billing portal."}
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
      );
    })()}
  </Surface>
);

function basicPlanCta(data: BillingData, isComped: boolean): string {
  const basicCta =
    data.tier === "basic"
      ? isComped
        ? "Start paying for Basic"
        : "Current plan"
      : data.tier === "pro"
        ? "Included in Pro"
        : "Upgrade to Basic";
  return basicCta;
}
function proPlanCta(data: BillingData, isComped: boolean): string {
  const proCta =
    data.tier === "pro"
      ? isComped
        ? "Start paying for Pro"
        : "Current plan"
      : "Upgrade to Pro";
  return proCta;
}
function basicPlanDisabled(
  data: BillingData,
  basicPlan: ReturnType<typeof resolvePaidPlan>,
  busy: boolean,
  checkoutBlocked: boolean,
  offer: BasicIntroOffer,
  isComped: boolean,
): boolean {
  const basicDisabled =
    !basicPlan ||
    requiresStripeManagement(data) ||
    data.billingSource === "forced" ||
    busy ||
    checkoutBlocked ||
    offer.status === "unavailable" ||
    data.tier === "pro" ||
    (data.tier === "basic" && !isComped);
  return basicDisabled;
}
function proPlanDisabled(
  data: BillingData,
  proPlan: ReturnType<typeof resolvePaidPlan>,
  busy: boolean,
  checkoutBlocked: boolean,
  isComped: boolean,
): boolean {
  const proDisabled =
    !proPlan ||
    requiresStripeManagement(data) ||
    data.billingSource === "forced" ||
    busy ||
    checkoutBlocked ||
    (data.tier === "pro" && !isComped);
  return proDisabled;
}

function BillingPlanCards({
  data,
  interval,
  basicPlan,
  proPlan,
  offer,
  busy,
  checkoutBlocked,
  onCheckout,
  shownOffer,
}: Pick<
  BillingPlansProps,
  | "data"
  | "interval"
  | "basicPlan"
  | "proPlan"
  | "offer"
  | "busy"
  | "checkoutBlocked"
  | "onCheckout"
> & { shownOffer: BasicIntroOffer }) {
  const isComped = data.billingSource === "manual_comp";
  const basicCta = basicPlanCta(data, isComped);
  const proCta = proPlanCta(data, isComped);
  const basicDisabled = basicPlanDisabled(
    data,
    basicPlan,
    busy,
    checkoutBlocked,
    offer,
    isComped,
  );
  const proDisabled = proPlanDisabled(
    data,
    proPlan,
    busy,
    checkoutBlocked,
    isComped,
  );
  const checkoutBasic = () => onCheckout("basic");
  const checkoutPro = () => onCheckout("pro");
  return (
    <div className={classes.plans}>
      <PricingCard
        name="Free"
        price="$0"
        description="Lightweight coverage for smaller servers."
        features={[
          "4 recording hours per rolling week",
          "Up to 90 minutes per meeting",
          "Ask across up to 5 meetings",
          "Notes, tags, and summaries",
        ]}
        cta={data.tier === "free" ? "Current plan" : "Available"}
        ctaDisabled={data.tier !== "free"}
        ctaProps={{
          variant: data.tier === "free" ? "light" : "outline",
        }}
        badge={data.tier === "free" ? "Current plan" : "Free forever"}
        billingLabel="Always free"
        testId="billing-plan-free"
      />
      <PricingCard
        name="Basic"
        price={introOfferPrice(shownOffer, basicPlan, interval)}
        description="Unlock longer sessions and deeper recall."
        features={[
          "20 recording hours per rolling week",
          "Up to 2 hours per meeting",
          "Ask across up to 25 meetings",
          "Live voice mode",
        ]}
        cta={basicCta}
        ctaDisabled={basicDisabled}
        ctaProps={
          basicDisabled
            ? { variant: "light" }
            : { variant: "filled", onClick: checkoutBasic }
        }
        highlighted
        badge={data.tier === "basic" ? "Current plan" : "Best value"}
        billingLabel={billingLabelForInterval(interval)}
        terms={<BasicIntroTerms offer={shownOffer} />}
        introOffer={shownOffer}
        testId="billing-plan-basic"
      />
      <PricingCard
        name="Pro"
        price={formatPlanPrice(proPlan, interval)}
        description="More recording time and a wider Ask history."
        features={[
          "No weekly recording limit",
          "Ask across up to 100 meetings",
          "Up to 2 hours per meeting",
          "Priority features + support",
        ]}
        cta={proCta}
        ctaDisabled={proDisabled}
        ctaProps={proDisabled ? { variant: "light" } : { onClick: checkoutPro }}
        badge={data.tier === "pro" ? "Current plan" : "More recording time"}
        tone="default"
        borderColor={uiColors.accentBorder}
        borderWidth={uiBorders.accentWidth}
        billingLabel={billingLabelForInterval(interval)}
        testId="billing-plan-pro"
      />
    </div>
  );
}

function IntroOfferAvailability({ offer }: { offer: BasicIntroOffer }) {
  return (
    <>
      {offer.status === "unavailable" && (
        <Alert title="Introductory pricing unavailable" color="yellow">
          Refresh offers before starting Basic checkout.
        </Alert>
      )}
      {offer.status === "expired" && (
        <Alert title="Introductory enrollment ended" color="gray">
          The regular Basic price is shown. Choose a plan to continue at that
          price.
        </Alert>
      )}
    </>
  );
}

function BillingPlansSection({
  data,
  interval,
  onIntervalChange,
  hasAnnualPlans,
  showPlans,
  onExpandPlans,
  onTogglePlans,
  onCheckout,
  promoCode,
  onPromoCodeChange,
  basicPlan,
  proPlan,
  offer,
  offerChoice,
  onOfferChoiceChange,
  busy,
  checkoutBlocked,
}: BillingPlansProps) {
  const isFreePlan = data.tier === "free";
  const isComped = data.billingSource === "manual_comp";
  const plansExpanded = isFreePlan || isComped ? true : showPlans;
  const hasPromo = promoCode.trim().length > 0;
  const managementOnly =
    requiresStripeManagement(data) || data.billingSource === "forced";
  const shownOffer =
    offerChoice === "promotion" && hasPromo
      ? { status: "inactive" as const }
      : offer;
  const changeInterval = (value: string) =>
    onIntervalChange(value as BillingInterval);
  const changePromo = (event: ChangeEvent<HTMLInputElement>) =>
    onPromoCodeChange(event.currentTarget.value);
  const clearPromo = () => onPromoCodeChange("");
  return (
    <Surface
      p="lg"
      tone="default"
      onClick={!plansExpanded ? onExpandPlans : undefined}
      style={{
        width: "100%",
        containerType: "inline-size",
        ...(plansExpanded
          ? {}
          : {
              cursor: "pointer",
              borderColor: uiColors.highlightBorder,
            }),
      }}
      data-testid="billing-plans"
    >
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="sm" align="center">
            <Title order={4}>Plans</Title>
          </Group>
          <SegmentedControl
            value={interval}
            onChange={changeInterval}
            data={[
              { label: "Monthly", value: "month" },
              {
                label: "Annual",
                value: "year",
                disabled: !hasAnnualPlans,
              },
            ]}
            size="sm"
            data-testid="billing-interval"
            aria-label="Billing period"
            classNames={{
              root: classes.billingPeriod,
              control: classes.control,
              label: classes.label,
            }}
            disabled={busy || checkoutBlocked}
          />
          {isFreePlan ? null : (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={onTogglePlans}
            >
              {plansExpanded ? "Hide plans" : "Compare plans"}
            </Button>
          )}
        </Group>
        {!managementOnly && (
          <Stack gap={4}>
            <Group gap="sm" align="flex-end" wrap="wrap">
              <TextInput
                label="Promo code"
                placeholder="Enter code"
                className="ph-no-capture"
                value={promoCode}
                disabled={busy || checkoutBlocked}
                onChange={changePromo}
                style={{ flex: "1 1 220px" }}
              />
              {hasPromo ? (
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  disabled={busy || checkoutBlocked}
                  onClick={clearPromo}
                >
                  Clear
                </Button>
              ) : null}
            </Group>
            <Text size="xs" c="dimmed">
              One code per purchase. Applied at checkout.
            </Text>
          </Stack>
        )}
        {!managementOnly && offer.status === "available" && hasPromo && (
          <IntroPromotionChoice
            choice={offerChoice}
            onChange={onOfferChoiceChange}
            disabled={busy || checkoutBlocked}
          />
        )}
        <IntroOfferAvailability offer={offer} />
        {!plansExpanded ? (
          <Text size="sm" c="dimmed">
            Compare plan details when you are ready to change tiers.
          </Text>
        ) : null}
        <Collapse expanded={plansExpanded}>
          <Divider my="sm" />
          <BillingPlanCards
            data={data}
            interval={interval}
            basicPlan={basicPlan}
            proPlan={proPlan}
            offer={offer}
            busy={busy}
            checkoutBlocked={checkoutBlocked}
            onCheckout={onCheckout}
            shownOffer={shownOffer}
          />
        </Collapse>
      </Stack>
    </Surface>
  );
}

type CheckoutRequest = inferRouterInputs<AppRouter>["billing"]["checkout"];
function billingCheckoutRequest({
  serverId: selectedGuildId,
  tier,
  interval,
  promotionCode,
  offer,
  offerChoice,
  source,
  limitContext,
}: {
  serverId: string;
  tier: PaidTier;
  interval: BillingInterval;
  promotionCode: string;
  offer: BasicIntroOffer;
  offerChoice: IntroOfferChoice;
  source: CheckoutRequest["source"];
  limitContext: ReturnType<typeof resolveRecordingLimitContext>;
}): CheckoutRequest {
  const request: inferRouterInputs<AppRouter>["billing"]["checkout"] = {
    serverId: selectedGuildId,
    tier,
    interval,
    promotionCode:
      tier === "basic" &&
      offer.status === "available" &&
      offerChoice === "automatic"
        ? undefined
        : promotionCode || undefined,
    savedPromotionCode: promotionCode || undefined,
    expectedOffer:
      tier === "basic" &&
      offer.status === "available" &&
      offerChoice === "automatic"
        ? offer.id
        : "none",
    offerChoice,
    source,
    ...limitContext,
    ...(isDoNotTrackEnabled() ? { analyticsDisabled: true } : {}),
  };
  return request;
}

function checkoutIsBlocked({
  busy,
  refreshing,
  failedCheckout,
  billingFetching,
  pricingFetching,
  pricingError,
  data,
  tier,
  offer,
}: {
  busy: boolean;
  refreshing: boolean;
  failedCheckout: CheckoutRequest | null;
  billingFetching: boolean;
  pricingFetching: boolean;
  pricingError: boolean;
  data: BillingData | null;
  tier: PaidTier;
  offer: BasicIntroOffer;
}): boolean {
  return Boolean(
    busy ||
    refreshing ||
    failedCheckout ||
    billingFetching ||
    pricingFetching ||
    pricingError ||
    (data && requiresStripeManagement(data)) ||
    data?.billingSource === "forced" ||
    (tier === "basic" && offer.status === "unavailable"),
  );
}

function BillingCurrentPlan({
  data,
  serverName,
  isPortalPending,
  selectedGuildId,
  busy,
  onPortal: handlePortal,
  normalPlan,
}: {
  data: BillingData;
  serverName: string;
  isPortalPending: boolean;
  selectedGuildId: string | null;
  busy: boolean;
  onPortal: () => void;
  normalPlan: ReturnType<typeof resolvePaidPlan>;
}) {
  const isFreeTier = data.tier === "free";
  const hasTerminalSubscription = isTerminalStripeHistory(data);
  const statusLabel = formatStatusLabel(data.status);
  const statusLine = formatStatusLine(statusLabel, data.nextBillingDate);
  return (
    <>
      {isFreeTier && (!data.hasStripeBilling || hasTerminalSubscription) ? (
        <BillingFreePanel serverName={serverName} usage={data.usage} />
      ) : (
        <BillingPaidPanel
          data={data}
          serverName={serverName}
          statusLabel={statusLabel}
          statusLine={statusLine}
          usage={data.usage}
          isPortalPending={isPortalPending}
          canManage={
            Boolean(selectedGuildId) && data.canManageBillingPortal && !busy
          }
          onPortal={handlePortal}
          normalPrice={normalPlan ? formatPlanPrice(normalPlan, "month") : null}
        />
      )}
      {hasTerminalSubscription ? (
        <Surface p="xl" data-testid="billing-subscription-history">
          <Stack gap="sm">
            <Title order={4}>Billing history</Title>
            <Text size="sm" c="dimmed">
              Previous subscription:{" "}
              {(data.stripeStatus ?? data.status) === "canceled"
                ? "Canceled"
                : "Expired"}
              .
            </Text>
            {data.canManageBillingPortal ? (
              <Group>
                <Button
                  variant="light"
                  disabled={!selectedGuildId || busy}
                  loading={isPortalPending}
                  onClick={handlePortal}
                  data-testid="billing-manage"
                >
                  View billing history
                </Button>
              </Group>
            ) : null}
          </Stack>
        </Surface>
      ) : null}
    </>
  );
}

function useBillingRoute() {
  const search = useSearch({ from: "/portal/server/$serverId/billing" });
  const navigate = useNavigate({ from: "/portal/server/$serverId/billing" });
  const interval = search.interval ?? "month";
  const source =
    search.source === undefined
      ? "portal_billing"
      : resolvePurchaseSource(search.source);
  const limitContext = useMemo(
    () => resolveRecordingLimitContext(search),
    [search.limitType, search.limitSurface],
  );
  const { serverId: routeServerId } = useParams({
    from: "/portal/server/$serverId/billing",
  });
  const [promoCode, setPromoCode] = useState(() => search.promo ?? "");
  const offerChoice = promoCode.trim()
    ? (search.offerChoice ?? "automatic")
    : "automatic";
  useEffect(() => setPromoCode(search.promo ?? ""), [search.promo]);
  return {
    search,
    navigate,
    interval,
    source,
    limitContext,
    routeServerId,
    promoCode,
    setPromoCode,
    offerChoice,
  };
}

function useBillingPricing(
  pricingData: RouterOutput["pricing"]["plans"] | undefined,
  data: BillingData | null,
  frozenOffer: BasicIntroOffer | null,
  interval: BillingInterval,
  refetchOffers: () => Promise<unknown>,
) {
  const liveOffers = useIntroOfferExpiry(data, refetchOffers);
  const paidPlans = pricingData?.plans ?? [];
  const planLookup = useMemo(() => buildPaidPlanLookup(paidPlans), [paidPlans]);
  const basicPlan = resolvePaidPlan(planLookup, "basic", interval);
  const proPlan = resolvePaidPlan(planLookup, "pro", interval);
  const normalPlan = resolvePaidPlan(
    planLookup,
    data?.tier === "pro" ? "pro" : "basic",
    "month",
  );
  const offer =
    frozenOffer ??
    resolveIntroOffer(
      interval === "year" ? liveOffers.annualIntroOffer : liveOffers.introOffer,
      basicPlan,
    );
  const hasAnnualPlans = paidPlans.some((plan) => plan.interval === "year");
  return { basicPlan, proPlan, normalPlan, planLookup, offer, hasAnnualPlans };
}

function useBillingEntryAnalytics({
  loading,
  error,
  data,
  selectedGuildId,
  source,
  limitContext,
}: {
  loading: boolean;
  error: string | null;
  data: BillingData | null;
  selectedGuildId: string | null;
  source: CheckoutRequest["source"];
  limitContext: ReturnType<typeof resolveRecordingLimitContext>;
}) {
  const arrivedServers = useRef(new Set<string>());
  useEffect(() => {
    if (
      loading ||
      error ||
      !data ||
      !selectedGuildId ||
      arrivedServers.current.has(selectedGuildId)
    )
      return;
    arrivedServers.current.add(selectedGuildId);
    track("billing_entry_arrived", {
      guild_id: selectedGuildId,
      source,
      ...recordingLimitAnalytics(limitContext ?? {}),
      current_tier: data.tier,
      event_version: 1,
    });
  }, [loading, error, data, selectedGuildId, source, limitContext]);
}

function useBillingQueries(routeServerId: string) {
  const { selectedGuildId, guilds, loading: guildLoading } = useGuildContext();
  const billingQuery = trpc.billing.me.useQuery(
    { serverId: selectedGuildId ?? undefined },
    { enabled: Boolean(selectedGuildId) },
  );
  const pricingQuery = trpc.pricing.plans.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });
  const serverName = useMemo(
    () =>
      guilds.find((g) => g.id === selectedGuildId)?.name || "Unknown server",
    [guilds, selectedGuildId],
  );
  const data = billingQuery.data ?? null;
  const loading =
    billingQuery.isLoading ||
    guildLoading ||
    Boolean(selectedGuildId && selectedGuildId !== routeServerId);
  const error = billingQuery.error ? "Unable to load billing status." : null;

  return {
    selectedGuildId,
    billingQuery,
    pricingQuery,
    serverName,
    data,
    loading,
    error,
  };
}

function useBillingOfferExposure({
  data,
  offer,
  offerChoice,
  routeServerId,
  selectedGuildId,
  loading,
  error,
  showPlans,
  setShowPlans,
}: {
  data: BillingData | null;
  offer: BasicIntroOffer;
  offerChoice: IntroOfferChoice;
  routeServerId: string;
  selectedGuildId: string | null;
  loading: boolean;
  error: string | null;
  showPlans: boolean;
  setShowPlans: (value: boolean) => void;
}) {
  const isFreeTier = data?.tier === "free";
  const displayedOffer =
    offer.status === "available" && offerChoice === "automatic"
      ? offer.id
      : "none";
  useIntroOfferExposure({
    offer: displayedOffer,
    entry: `portal_billing:${routeServerId}`,
    surface: "portal_billing",
    guildId: selectedGuildId ?? undefined,
    enabled: !loading && !error && showPlans,
  });

  useEffect(() => {
    if (isFreeTier) {
      setShowPlans(true);
    }
  }, [isFreeTier]);

  return displayedOffer;
}

function BillingCheckoutRecovery({
  offer,
  failedCheckout,
  busy,
  retryCheckout,
  refreshOffers,
}: {
  offer: BasicIntroOffer;
  failedCheckout: CheckoutRequest | null;
  busy: boolean;
  retryCheckout: () => void;
  refreshOffers: () => void;
}) {
  return (
    <>
      {(offer.status === "unavailable" || failedCheckout) && (
        <Stack gap="xs">
          <Text size="sm">
            A previous checkout may still be pending. Retry keeps its original
            terms. Refreshing does not cancel it or change its terms.
          </Text>
          <Group>
            {failedCheckout && (
              <Button disabled={busy} onClick={retryCheckout}>
                Retry checkout
              </Button>
            )}
            <Button disabled={busy} variant="light" onClick={refreshOffers}>
              Refresh offers
            </Button>
          </Group>
        </Stack>
      )}
    </>
  );
}

function savedCheckoutQuote(
  checkoutAttempt: ReturnType<typeof useCheckoutAttempt>,
) {
  return {
    failedCheckout: checkoutAttempt.attempt?.request ?? null,
    frozenOffer: checkoutAttempt.attempt?.offer ?? null,
  };
}

export function Billing() {
  const [showPlans, setShowPlans] = useState(false);
  const {
    search,
    navigate,
    interval,
    source,
    limitContext,
    routeServerId,
    promoCode,
    setPromoCode,
    offerChoice,
  } = useBillingRoute();
  const {
    selectedGuildId,
    billingQuery,
    pricingQuery,
    serverName,
    data,
    loading,
    error,
  } = useBillingQueries(routeServerId);
  const checkoutMutation = trpc.billing.checkout.useMutation();
  const portalMutation = trpc.billing.portal.useMutation();
  const attemptIdentity = JSON.stringify([
    routeServerId,
    interval,
    offerChoice,
    promoCode.trim(),
    source,
    limitContext,
  ]);
  const checkoutAttempt = useCheckoutAttempt(attemptIdentity, () =>
    Promise.allSettled([billingQuery.refetch(), pricingQuery.refetch()]),
  );
  const { failedCheckout, frozenOffer } = savedCheckoutQuote(checkoutAttempt);

  const { basicPlan, proPlan, normalPlan, planLookup, offer, hasAnnualPlans } =
    useBillingPricing(pricingQuery.data, data, frozenOffer, interval, () =>
      Promise.allSettled([billingQuery.refetch(), pricingQuery.refetch()]),
    );
  const busy = checkoutMutation.isPending || portalMutation.isPending;
  const isPortalPending = portalMutation.isPending;
  const displayedOffer = useBillingOfferExposure({
    data,
    offer,
    offerChoice,
    routeServerId,
    selectedGuildId,
    loading,
    error,
    showPlans,
    setShowPlans,
  });

  useBillingEntryAnalytics({
    loading,
    error,
    data,
    selectedGuildId,
    source,
    limitContext,
  });

  const handleCheckout = async (tier: PaidTier) => {
    let attempt: ReturnType<typeof checkoutAttempt.begin> | null = null;
    try {
      if (!selectedGuildId || selectedGuildId !== routeServerId) return;
      if (
        checkoutIsBlocked({
          busy,
          refreshing: checkoutAttempt.refreshing,
          failedCheckout,
          billingFetching: billingQuery.isFetching,
          pricingFetching: pricingQuery.isFetching,
          pricingError: pricingQuery.isError,
          data,
          tier,
          offer,
        })
      )
        return;
      const plan = resolvePaidPlan(planLookup, tier, interval);
      if (!plan) {
        notifications.show({
          color: "red",
          title: "Pricing unavailable",
          message: "We could not find pricing for that plan. Please try again.",
        });
        return;
      }
      const promotionCode = promoCode.trim();
      track("upgrade_plan_clicked", {
        guild_id: selectedGuildId,
        tier,
        interval,
        source,
        ...recordingLimitAnalytics(limitContext ?? {}),
        promo_present: Boolean(promotionCode),
        offer: tier === "basic" ? displayedOffer : "none",
        event_version: 1,
      });
      const request = billingCheckoutRequest({
        serverId: selectedGuildId,
        tier,
        interval,
        promotionCode,
        offer,
        offerChoice,
        source,
        limitContext,
      });
      attempt = checkoutAttempt.begin(request, offer);
      const body = await checkoutMutation.mutateAsync(request);
      if (checkoutAttempt.isCurrent(attempt)) window.location.href = body.url;
    } catch (err) {
      if (attempt && checkoutAttempt.isCurrent(attempt)) {
        console.error(err);
        showBillingError(err, "checkout");
      }
    }
  };

  const handlePortal = async () => {
    try {
      if (!selectedGuildId || selectedGuildId !== routeServerId) return;
      if (busy) return;
      const body = await portalMutation.mutateAsync({
        serverId: selectedGuildId,
      });
      window.location.href = body.url;
    } catch (err) {
      console.error(err);
      showBillingError(err, "portal");
    }
  };

  const changeInterval = (value: BillingInterval) =>
    navigate({
      replace: true,
      search: {
        ...search,
        interval: value,
        promo: promoCode.trim() || undefined,
      },
    });
  const changePromo = (value: string) => {
    setPromoCode(value);
    navigate({
      replace: true,
      search: { ...search, promo: value.trim() || undefined },
    });
  };
  const changeOffer = (value: IntroOfferChoice) =>
    navigate({ replace: true, search: { ...search, offerChoice: value } });
  const expandPlans = () => setShowPlans(true);
  const togglePlans = () => setShowPlans((prev) => !prev);
  const refreshOffers = () => checkoutAttempt.refresh();
  const retryCheckout = async () => {
    const attempt = checkoutAttempt.attempt;
    if (
      busy ||
      !selectedGuildId ||
      selectedGuildId !== routeServerId ||
      !attempt ||
      !checkoutAttempt.isCurrent(attempt)
    )
      return;
    try {
      const body = await checkoutMutation.mutateAsync(attempt.request);
      if (checkoutAttempt.isCurrent(attempt)) window.location.href = body.url;
    } catch (error) {
      if (checkoutAttempt.isCurrent(attempt))
        showBillingError(error, "checkout");
    }
  };

  if (loading) {
    return <BillingLoadingState />;
  }

  if (error) {
    return <BillingErrorState message={error} />;
  }

  if (!data) {
    return <BillingNoServerState />;
  }

  if (!data.billingEnabled) {
    return <BillingDisabledState />;
  }

  return (
    <BillingShell>
      <RecordingPlanContext context={limitContext} />
      <BillingCurrentPlan
        data={data}
        serverName={serverName}
        isPortalPending={isPortalPending}
        selectedGuildId={selectedGuildId}
        busy={busy}
        onPortal={handlePortal}
        normalPlan={normalPlan}
      />
      <BillingPlansSection
        data={data}
        interval={interval}
        onIntervalChange={changeInterval}
        hasAnnualPlans={hasAnnualPlans}
        showPlans={showPlans}
        onExpandPlans={expandPlans}
        onTogglePlans={togglePlans}
        onCheckout={handleCheckout}
        promoCode={promoCode}
        onPromoCodeChange={changePromo}
        basicPlan={basicPlan}
        proPlan={proPlan}
        offer={offer}
        offerChoice={offerChoice}
        onOfferChoiceChange={changeOffer}
        busy={
          busy ||
          billingQuery.isFetching ||
          pricingQuery.isFetching ||
          checkoutAttempt.refreshing
        }
        checkoutBlocked={Boolean(failedCheckout) || pricingQuery.isError}
      />
      <BillingCheckoutRecovery
        offer={offer}
        failedCheckout={failedCheckout}
        busy={busy}
        retryCheckout={retryCheckout}
        refreshOffers={refreshOffers}
      />
    </BillingShell>
  );
}

export default Billing;
