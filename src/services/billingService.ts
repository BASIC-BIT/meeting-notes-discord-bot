import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { getPaymentTransactionRepository } from "../repositories/paymentTransactionRepository";
import { config } from "./configService";
import {
  clearGuildSubscriptionCache,
  getLimitsForTier,
  resolveGuildSubscription,
} from "./subscriptionService";
import { autoRevokeCoveredCompGrants } from "./entitlementService";
import { getRollingUsageForGuild } from "./meetingUsageService";
import { nowIso } from "../utils/time";
import type {
  BillingInterval,
  PaidTier,
  ExpectedIntroOffer,
  IntroOfferChoice,
  BasicIntroOffer,
  ProviderSubscriptionDetails,
} from "../types/pricing";
import type { GuildSubscription, PaymentTransaction } from "../types/db";
import type { StripeClient, StripeSubscription } from "../types/stripe";
import type { PublicEntitlementGrant } from "./entitlementService";
import {
  resolvePurchaseSource,
  resolveRecordingLimitContext,
  type RecordingLimitContext,
  type PurchaseSource,
} from "../utils/purchaseAnalytics";

import { BillingActionError } from "./billingActionError";
export { BillingActionError } from "./billingActionError";
import { createInitialPurchase } from "./initialPurchaseService";
import {
  BASIC_INTRO_PLAN_CHANGE_MESSAGE,
  getGuildBasicIntroOffer,
  getBasicIntroCustomerRestriction,
  getProviderSubscriptionDetails,
  SUBSCRIPTION_DISCOUNT_EXPANSIONS,
  verifyBasicIntroPortalConfiguration,
} from "./basicIntroOfferService";
export type BillingSnapshot = {
  introOffer?: BasicIntroOffer;
  annualIntroOffer?: BasicIntroOffer;
  subscriptionDetails?: ProviderSubscriptionDetails | null;
  billingEnabled: boolean;
  stripeMode: string;
  tier: "free" | "basic" | "pro";
  status: string;
  billingSource: "free" | "stripe" | "manual_comp" | "forced";
  stripeTier: "free" | "basic" | "pro" | null;
  grantTier: "basic" | "pro" | null;
  activeGrant: PublicEntitlementGrant | null;
  nextBillingDate: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  hasStripeBilling: boolean;
  canManageBillingPortal: boolean;
  upgradeUrl: string | null;
  portalUrl: string | null;
  usage: {
    usedMinutes: number;
    limitMinutes: number | null;
    windowStartIso: string;
    windowEndIso: string;
  } | null;
};

type StripeUser = {
  id: string;
  email?: string;
  username?: string;
};

export function buildBillingDisabledSnapshot(): BillingSnapshot {
  return {
    introOffer: { status: "inactive" },
    annualIntroOffer: { status: "inactive" },
    subscriptionDetails: null,
    tier: "free",
    status: "free",
    billingSource: "free",
    stripeTier: null,
    grantTier: null,
    activeGrant: null,
    nextBillingDate: null,
    subscriptionId: null,
    customerId: null,
    hasStripeBilling: false,
    canManageBillingPortal: false,
    upgradeUrl: config.stripe.billingLandingUrl || null,
    portalUrl: null,
    billingEnabled: false,
    stripeMode: config.subscription.stripeMode || "disabled",
    usage: null,
  };
}

export async function getBillingSnapshot(params: {
  stripe: StripeClient | null;
  guildId: string;
  payerId?: string;
}): Promise<BillingSnapshot> {
  const { stripe, guildId } = params;
  if (!stripe || !config.stripe.secretKey) {
    return buildBillingDisabledSnapshot();
  }

  const [subscription, resolvedSubscription] = await Promise.all([
    getSubscriptionRepository().get(guildId),
    resolveGuildSubscription(guildId),
  ]);

  const limits = getLimitsForTier(resolvedSubscription.tier);
  const usage = await getRollingUsageForGuild(guildId);
  const usedMinutes = Math.ceil(usage.usedSeconds / 60);
  const limitMinutes = limits.maxMeetingMinutesRolling ?? null;
  const hasStripeBilling = Boolean(
    subscription?.stripeSubscriptionId || subscription?.stripeCustomerId,
  );

  const [introOffer, annualIntroOffer, subscriptionDetails] = await Promise.all(
    [
      getGuildBasicIntroOffer({ stripe, guildId, payerId: params.payerId }),
      getGuildBasicIntroOffer({
        stripe,
        guildId,
        payerId: params.payerId,
        interval: "year",
      }),
      loadProviderSubscriptionDetails(stripe, guildId, subscription),
    ],
  );
  return {
    introOffer,
    annualIntroOffer,
    subscriptionDetails,
    tier: resolvedSubscription.tier,
    status: resolvedSubscription.status,
    billingSource: resolvedSubscription.billingSource,
    stripeTier: resolvedSubscription.stripeTier,
    grantTier: resolvedSubscription.grantTier,
    activeGrant: resolvedSubscription.activeGrant,
    nextBillingDate:
      resolvedSubscription.billingSource === "stripe"
        ? subscription?.nextBillingDate || null
        : null,
    subscriptionId: subscription?.stripeSubscriptionId || null,
    customerId: subscription?.stripeCustomerId || null,
    hasStripeBilling,
    canManageBillingPortal: hasStripeBilling,
    upgradeUrl: config.stripe.billingLandingUrl || null,
    portalUrl: null,
    billingEnabled: true,
    stripeMode: config.subscription.stripeMode || "live",
    usage: {
      usedMinutes,
      limitMinutes,
      windowStartIso: usage.windowStartIso,
      windowEndIso: usage.windowEndIso,
    },
  };
}

export async function getMockBillingSnapshot(
  guildId: string,
): Promise<BillingSnapshot> {
  const [subscription, resolvedSubscription] = await Promise.all([
    getSubscriptionRepository().get(guildId),
    resolveGuildSubscription(guildId),
  ]);
  const limits = getLimitsForTier(resolvedSubscription.tier);
  const usage = await getRollingUsageForGuild(guildId);
  const usedMinutes = Math.ceil(usage.usedSeconds / 60);
  const limitMinutes = limits.maxMeetingMinutesRolling ?? null;
  const hasStripeBilling = Boolean(
    subscription?.stripeSubscriptionId || subscription?.stripeCustomerId,
  );

  return {
    introOffer: { status: "inactive" },
    annualIntroOffer: { status: "inactive" },
    subscriptionDetails: null,
    tier: resolvedSubscription.tier,
    status: resolvedSubscription.status,
    billingSource: resolvedSubscription.billingSource,
    stripeTier: resolvedSubscription.stripeTier,
    grantTier: resolvedSubscription.grantTier,
    activeGrant: resolvedSubscription.activeGrant,
    nextBillingDate:
      resolvedSubscription.billingSource === "stripe"
        ? subscription?.nextBillingDate || null
        : null,
    subscriptionId: subscription?.stripeSubscriptionId || null,
    customerId: subscription?.stripeCustomerId || null,
    hasStripeBilling,
    canManageBillingPortal: hasStripeBilling,
    upgradeUrl: `/portal/server/${guildId}/billing?mock=checkout`,
    portalUrl: null,
    billingEnabled: true,
    stripeMode: "mock",
    usage: {
      usedMinutes,
      limitMinutes,
      windowStartIso: usage.windowStartIso,
      windowEndIso: usage.windowEndIso,
    },
  };
}

export async function seedMockSubscription(guildId: string) {
  const repo = getSubscriptionRepository();
  const existing = await repo.get(guildId);
  await repo.write({
    guildId,
    status: "active",
    tier: "basic",
    subscriptionType: "mock",
    startDate: existing?.startDate ?? nowIso(),
    nextBillingDate:
      existing?.nextBillingDate ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 25).toISOString(),
    stripeCustomerId: existing?.stripeCustomerId ?? "cus_mock_basic",
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? "sub_mock_basic",
    mode: "test",
  });
  clearGuildSubscriptionCache(guildId);
  await autoRevokeCoveredCompGrants({
    guildId,
    paidTier: "basic",
    stripeSubscriptionId: "sub_mock_basic",
  });
  clearGuildSubscriptionCache(guildId);
}

export async function saveGuildSubscription(subscription: GuildSubscription) {
  await getSubscriptionRepository().write(subscription);
  clearGuildSubscriptionCache(subscription.guildId);
}

export async function recordPaymentTransaction(
  transaction: PaymentTransaction,
) {
  await getPaymentTransactionRepository().write(transaction);
}

export async function ensureStripeCustomer(
  stripe: StripeClient,
  user: StripeUser,
): Promise<string> {
  const searchEmail = user.email;
  if (searchEmail) {
    let startingAfter: string | undefined;
    do {
      const found = await stripe.customers.list({
        email: searchEmail,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const owned = found.data.find(
        (customer) => customer.metadata.discord_id === user.id,
      );
      if (owned) return owned.id;
      startingAfter = found.has_more ? found.data.at(-1)?.id : undefined;
    } while (startingAfter);
  }
  const created = await stripe.customers.create({
    ...(searchEmail ? { email: searchEmail } : {}),
    metadata: {
      discord_id: user.id,
      discord_username: user.username ?? "",
      // Lets PostHog revenue analytics join this Stripe customer to the
      // PostHog person. Must match the distinct id used by the portal and the
      // bot, which is the Discord user id.
      posthog_person_distinct_id: user.id,
    },
  });
  return created.id;
}

export async function resolvePromotionCodeId(
  stripe: Pick<StripeClient, "promotionCodes">,
  code: string,
): Promise<string | null> {
  const normalized = code.trim();
  if (!normalized) return null;
  const matches = await stripe.promotionCodes.list({
    code: normalized,
    active: true,
    limit: 1,
  });
  return matches.data[0]?.id ?? null;
}

function appendQueryParams(
  baseUrl: string,
  params: Record<string, string | undefined>,
): string {
  const entries = Object.entries(params).filter(([, value]) => value?.length);
  if (!entries.length) return baseUrl;
  try {
    const url = new URL(baseUrl);
    entries.forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    return url.toString();
  } catch {
    const [path, query = ""] = baseUrl.split("?");
    const searchParams = new URLSearchParams(query);
    entries.forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
    const next = searchParams.toString();
    return next ? `${path}?${next}` : path;
  }
}

type CheckoutSessionInput = {
  stripe: StripeClient;
  user: StripeUser;
  guildId: string;
  priceId?: string | null;
  promotionCodeId?: string | null;
  promotionCode?: string | null;
  savedPromotionCode?: string;
  allowPromotionCodes?: boolean;
  tier?: PaidTier;
  interval?: BillingInterval;
  source?: PurchaseSource;
  limitType?: RecordingLimitContext["limitType"];
  limitSurface?: RecordingLimitContext["limitSurface"];
  analyticsAllowed?: boolean;
  expectedOffer?: ExpectedIntroOffer;
  offerChoice?: IntroOfferChoice;
};

async function checkoutPromotion(params: CheckoutSessionInput) {
  const {
    stripe,
    promotionCode,
    promotionCodeId: suppliedPromotionCodeId,
  } = params;
  const promoValue = promotionCode?.trim();
  const savedPromo = params.savedPromotionCode?.trim();
  if (savedPromo && promoValue && savedPromo !== promoValue)
    throw new BillingActionError(
      "BAD_REQUEST",
      "Saved and selected promotion codes do not match.",
    );
  const promotionCodeId =
    suppliedPromotionCodeId ||
    (promoValue ? await resolvePromotionCodeId(stripe, promoValue) : null);
  if (promoValue && !promotionCodeId) {
    throw new BillingActionError("BAD_REQUEST", "Invalid promotion code");
  }
  return { promoValue, savedPromo, promotionCodeId };
}

function checkoutMetadata(
  user: StripeUser,
  guildId: string,
  source: PurchaseSource,
  limitContext: RecordingLimitContext | undefined,
  analyticsAllowed: boolean,
  tier: PaidTier | undefined,
  interval: BillingInterval | undefined,
  promoValue: string | undefined,
  savedPromo: string | undefined,
) {
  const metadata = {
    discord_id: user.id,
    discord_username: user.username ?? "",
    guild_id: guildId,
    purchase_source: source,
    ...(limitContext
      ? {
          recording_limit_type: limitContext.limitType,
          recording_limit_surface: limitContext.limitSurface,
        }
      : {}),
    ...(analyticsAllowed ? {} : { analytics_opt_out: "true" }),
    ...(tier ? { purchase_tier: tier } : {}),
    ...(interval ? { purchase_interval: interval } : {}),
    ...(promoValue ? { promo_code: promoValue } : {}),
    ...(savedPromo ? { purchase_promo_present: "true" } : {}),
  };
  return metadata;
}

function checkoutReturnUrls(
  params: CheckoutSessionInput,
  source: PurchaseSource,
  limitContext: RecordingLimitContext | undefined,
  savedPromo: string | undefined,
  promoValue: string | undefined,
) {
  const { guildId, tier, interval } = params;
  const successUrl = appendQueryParams(config.stripe.successUrl, {
    promo: savedPromo || promoValue || undefined,
    offerChoice: params.offerChoice ?? "automatic",
    serverId: guildId,
    plan: tier,
    interval,
    source,
    ...limitContext,
  });
  const cancelUrl = appendQueryParams(config.stripe.cancelUrl, {
    promo: savedPromo || promoValue || undefined,
    offerChoice: params.offerChoice ?? "automatic",
    serverId: guildId,
    plan: tier,
    interval,
    source,
    ...limitContext,
  });
  return { successUrl, cancelUrl };
}

export async function createCheckoutSession(
  params: CheckoutSessionInput,
): Promise<string> {
  const {
    stripe,
    user,
    guildId,
    priceId,
    allowPromotionCodes,
    tier,
    interval,
    source: sourceInput,
    analyticsAllowed = true,
  } = params;
  const source = resolvePurchaseSource(sourceInput);
  const limitContext = resolveRecordingLimitContext(params);
  const checkoutPriceId = priceId || config.stripe.priceBasic;
  if (!checkoutPriceId?.startsWith("price_")) {
    throw new Error("Stripe price not configured");
  }
  const { promoValue, savedPromo, promotionCodeId } =
    await checkoutPromotion(params);
  const { successUrl, cancelUrl } = checkoutReturnUrls(
    params,
    source,
    limitContext,
    savedPromo,
    promoValue,
  );
  const expected = await getSubscriptionRepository().get(guildId);
  const confirmationUrl = await createExistingSubscriptionConfirmation({
    stripe,
    user,
    guildId,
    checkoutPriceId,
    promotionCodeId,
    expectedOffer: params.expectedOffer,
    successUrl,
    cancelUrl,
  });
  if (confirmationUrl) return confirmationUrl;

  const metadata = checkoutMetadata(
    user,
    guildId,
    source,
    limitContext,
    analyticsAllowed,
    tier,
    interval,
    promoValue,
    savedPromo,
  );
  return createInitialPurchase({
    stripe,
    user,
    guildId,
    expected,
    expectedOffer: params.expectedOffer,
    offerChoice: params.offerChoice ?? "automatic",
    mode: config.subscription.stripeMode === "live" ? "live" : "test",
    checkout: {
      mode: "subscription",
      line_items: [{ price: checkoutPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      client_reference_id: user.id,
      allow_promotion_codes: promotionCodeId
        ? undefined
        : (allowPromotionCodes ?? true),
      discounts: promotionCodeId
        ? [{ promotion_code: promotionCodeId }]
        : undefined,
      subscription_data: {
        metadata,
      },
      metadata,
    },
  });
}

function assertUpdatableSubscription(subscription: StripeSubscription): void {
  if (
    !["active", "trialing"].includes(subscription.status) ||
    subscription.items.data.length !== 1 ||
    subscription.schedule ||
    subscription.pending_update ||
    subscription.pause_collection ||
    subscription.cancel_at_period_end ||
    subscription.cancel_at
  ) {
    throw new BillingActionError(
      "BAD_REQUEST",
      "Resolve the existing subscription in billing management before changing plans",
    );
  }
}

function assertExistingOfferQuote(
  expectedOffer: ExpectedIntroOffer | undefined,
  existing: GuildSubscription | undefined,
) {
  if (
    expectedOffer &&
    expectedOffer !== "none" &&
    (existing?.stripeSubscriptionId || existing?.stripeCustomerId)
  ) {
    throw new BillingActionError(
      "BAD_REQUEST",
      "Offer terms changed. Review the current price before continuing.",
    );
  }
}

async function createExistingSubscriptionConfirmation(params: {
  stripe: StripeClient;
  user: StripeUser;
  guildId: string;
  checkoutPriceId: string;
  promotionCodeId?: string | null;
  expectedOffer?: ExpectedIntroOffer;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  const {
    stripe,
    user,
    guildId,
    checkoutPriceId,
    promotionCodeId,
    successUrl,
    cancelUrl,
  } = params;
  const existing = await getSubscriptionRepository().get(guildId);
  assertExistingOfferQuote(params.expectedOffer, existing);
  if (existing?.stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(
      existing.stripeSubscriptionId,
      { expand: SUBSCRIPTION_DISCOUNT_EXPANSIONS },
    );
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    if (
      subscription.metadata.guild_id !== guildId ||
      (existing.stripeCustomerId && existing.stripeCustomerId !== customerId)
    ) {
      throw new BillingActionError(
        "BAD_REQUEST",
        "Server billing information does not match Stripe; contact support",
      );
    }
    // Only provider-confirmed terminal subscriptions can start a new purchase.
    // A failed read or unsupported state must never fall through to Checkout.
    if (
      subscription.status !== "canceled" &&
      subscription.status !== "incomplete_expired"
    ) {
      if (!config.stripe.subscriptionTransitionsEnabled) {
        throw new BillingActionError(
          "BAD_REQUEST",
          "Plan changes are not available yet. Your current subscription is unchanged; contact support for help.",
        );
      }
      await assertStripePayer(stripe, customerId, user.id);
      assertUpdatableSubscription(subscription);
      if (
        await getBasicIntroCustomerRestriction(stripe, customerId, subscription)
      ) {
        throw new BillingActionError(
          "BAD_REQUEST",
          BASIC_INTRO_PLAN_CHANGE_MESSAGE,
        );
      }
      const item = subscription.items.data[0];
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,

        return_url: cancelUrl,
        flow_data: {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: subscription.id,
            items: [
              { id: item.id, price: checkoutPriceId, quantity: item.quantity },
            ],
            ...(promotionCodeId
              ? { discounts: [{ promotion_code: promotionCodeId }] }
              : {}),
          },
          after_completion: {
            type: "redirect",
            redirect: { return_url: successUrl },
          },
        },
      });
      if (!portal.url)
        throw new Error("Stripe did not return a confirmation URL");
      return portal.url;
    }
  } else if (existing?.stripeCustomerId) {
    throw new BillingActionError(
      "BAD_REQUEST",
      "Server subscription information is missing; contact support before purchasing again",
    );
  }
  return null;
}

async function assertStripePayer(
  stripe: StripeClient,
  customerId: string,
  userId: string,
): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || customer.metadata.discord_id !== userId) {
    throw new BillingActionError(
      "FORBIDDEN",
      "Only the original payer can manage this server's Stripe billing",
    );
  }
}

function providerCustomerId(subscription: StripeSubscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

export async function createPortalSession(params: {
  stripe: StripeClient;
  user: StripeUser;
  guildId: string;
}): Promise<string> {
  const { stripe, user, guildId } = params;
  const subscription = await getSubscriptionRepository().get(guildId);
  if (!subscription?.stripeCustomerId && !subscription?.stripeSubscriptionId) {
    throw new Error("No Stripe billing found for guild");
  }
  const providerSubscription = subscription.stripeSubscriptionId
    ? await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
        expand: SUBSCRIPTION_DISCOUNT_EXPANSIONS,
      })
    : null;
  const customerId =
    subscription.stripeCustomerId ||
    (providerSubscription
      ? providerCustomerId(providerSubscription)
      : undefined);
  if (!customerId) throw new Error("No Stripe customer found for guild");
  await assertStripePayer(stripe, customerId, user.id);
  if (
    providerSubscription &&
    (providerSubscription.metadata.guild_id !== guildId ||
      providerCustomerId(providerSubscription) !== customerId)
  ) {
    throw new BillingActionError(
      "BAD_REQUEST",
      "Server billing information does not match Stripe; contact support",
    );
  }
  const restricted = await getBasicIntroCustomerRestriction(
    stripe,
    customerId,
    providerSubscription ?? undefined,
  );
  const configuration = restricted
    ? await verifyBasicIntroPortalConfiguration(
        stripe,
        restricted.configurationId,
      )
    : undefined;
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    ...(configuration ? { configuration } : {}),

    return_url: config.stripe.portalReturnUrl || config.stripe.successUrl,
  });
  if (!portal.url) {
    throw new Error("Stripe did not return a portal URL");
  }
  return portal.url;
}

async function loadProviderSubscriptionDetails(
  stripe: StripeClient,
  guildId: string,
  subscription: GuildSubscription | undefined,
): Promise<ProviderSubscriptionDetails | null> {
  if (!subscription?.stripeSubscriptionId) return null;
  try {
    const provider = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
      { expand: SUBSCRIPTION_DISCOUNT_EXPANSIONS },
    );
    const customerId =
      typeof provider.customer === "string"
        ? provider.customer
        : provider.customer.id;
    if (
      provider.metadata.guild_id !== guildId ||
      provider.livemode !== (config.subscription.stripeMode === "live") ||
      (subscription.stripeCustomerId &&
        subscription.stripeCustomerId !== customerId)
    )
      return { status: "unavailable" };
    const [details, restriction] = await Promise.all([
      getProviderSubscriptionDetails(stripe, provider),
      getBasicIntroCustomerRestriction(stripe, customerId, provider),
    ]);
    return details.status === "available"
      ? {
          ...details,
          planChangesRestricted: Boolean(restriction),
          planChangeRestrictionEndsAt: restriction?.endsAt ?? null,
        }
      : details;
  } catch {
    return { status: "unavailable" };
  }
}
