import type Stripe from "stripe";
import type { GuildSubscription } from "../types/db";
import type { PurchaseAttempt } from "../types/purchase";
import { getBestActiveEntitlementGrantForGuild } from "./entitlementService";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { getPurchaseRepository } from "../repositories/purchaseAttemptRepository";
import { getPaidPlans } from "./pricingService";
import { BillingActionError } from "./billingActionError";

import { z } from "zod";
import type {
  BasicIntroOffer,
  ExpectedIntroOffer,
  IntroOfferChoice,
  PaidPlan,
  ProviderSubscriptionDetails,
} from "../types/pricing";
import type { StripeClient } from "../types/stripe";
import { config } from "./configService";

const CHECKOUT_LIFETIME_SECONDS = 3600;
export const BASIC_INTRO_OFFER_ID = "basic_intro_v1";
const BASIC_INTRO_TERMS = {
  id: BASIC_INTRO_OFFER_ID,
  currency: "usd",
  regularUnitAmount: 1000,
  discountedUnitAmount: 600,
  percentOff: 40,
  durationMonths: 3,
} satisfies Omit<
  Extract<BasicIntroOffer, { status: "available" }>,
  "status" | "priceId" | "enrollmentEndsAt"
>;

export async function verifyBasicIntroPortalConfiguration(
  stripe: StripeClient,
  configurationId: string,
): Promise<string> {
  if (!configurationId)
    throw new Error("Introductory billing management is not configured");
  const portal =
    await stripe.billingPortal.configurations.retrieve(configurationId);
  if (
    !portal.active ||
    portal.id !== configurationId ||
    portal.livemode !== (config.subscription.stripeMode === "live") ||
    portal.features.subscription_update.enabled ||
    !portal.features.payment_method_update.enabled ||
    !portal.features.subscription_cancel.enabled
  ) {
    throw new Error("Introductory billing management configuration is unsafe");
  }
  return portal.id;
}

export async function getBasicIntroOffer(params: {
  stripe: StripeClient;
  plans: PaidPlan[];
  now?: number;
}): Promise<BasicIntroOffer> {
  const settings = { ...config.stripe.basicIntroOffer };
  const values = Object.values(settings);
  if (values.every((value) => !value)) return { status: "inactive" };
  if (values.some((value) => !value.trim())) return { status: "unavailable" };
  if (
    !z.iso.datetime({ offset: true }).safeParse(settings.startsAt).success ||
    !z.iso.datetime({ offset: true }).safeParse(settings.enrollmentEndsAt)
      .success
  )
    return { status: "unavailable" };
  const start = Date.parse(settings.startsAt);
  const end = Date.parse(settings.enrollmentEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    return { status: "unavailable" };
  const now = params.now ?? Date.now();
  if (now < start) return { status: "inactive" };
  if (now >= end) return { status: "expired" };
  const plan = params.plans.find(
    (candidate) => candidate.tier === "basic" && candidate.interval === "month",
  );
  if (
    !plan ||
    plan.currency !== BASIC_INTRO_TERMS.currency ||
    plan.unitAmount !== BASIC_INTRO_TERMS.regularUnitAmount
  )
    return { status: "unavailable" };
  try {
    const [price, coupon] = await Promise.all([
      params.stripe.prices.retrieve(plan.priceId),
      params.stripe.coupons.retrieve(settings.couponId, {
        expand: ["applies_to"],
      }),
      verifyBasicIntroPortalConfiguration(
        params.stripe,
        settings.portalConfigurationId,
      ),
    ]);
    const live = config.subscription.stripeMode === "live";
    if (
      price.lookup_key !== config.stripe.lookupKeys.basicMonthly ||
      price.transform_quantity ||
      !price.active ||
      price.id !== plan.priceId ||
      price.livemode !== live ||
      price.currency !== BASIC_INTRO_TERMS.currency ||
      price.unit_amount !== BASIC_INTRO_TERMS.regularUnitAmount ||
      price.billing_scheme !== "per_unit" ||
      price.type !== "recurring" ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed"
    )
      return { status: "unavailable" };
    const productId =
      typeof price.product === "string" ? price.product : price.product.id;
    if (
      coupon.deleted ||
      coupon.id !== settings.couponId ||
      !coupon.valid ||
      coupon.livemode !== live ||
      coupon.percent_off !== BASIC_INTRO_TERMS.percentOff ||
      coupon.amount_off !== null ||
      coupon.currency !== null ||
      coupon.duration !== "repeating" ||
      coupon.duration_in_months !== BASIC_INTRO_TERMS.durationMonths ||
      (coupon.redeem_by !== null &&
        coupon.redeem_by < Math.ceil(end / 1000) + CHECKOUT_LIFETIME_SECONDS) ||
      (coupon.applies_to && !coupon.applies_to.products.includes(productId))
    )
      return { status: "unavailable" };
    if ((params.now ?? Date.now()) >= end) return { status: "expired" };
    return {
      status: "available",
      ...BASIC_INTRO_TERMS,
      priceId: price.id,
      enrollmentEndsAt: settings.enrollmentEndsAt,
    };
  } catch {
    return { status: "unavailable" };
  }
}

const changedTerms = () =>
  new BillingActionError(
    "BAD_REQUEST",
    "Offer terms changed. Review the current price before continuing.",
  );
const unavailableOffer = () =>
  new BillingActionError(
    "BAD_REQUEST",
    "The Basic introductory offer is unavailable. Retry shortly before purchasing.",
  );
const choiceRequired = () =>
  new BillingActionError(
    "BAD_REQUEST",
    "Choose the introductory offer or your promotion code before continuing.",
  );

async function serverIsEligible(
  guildId: string,
  subscription: GuildSubscription | undefined,
) {
  return (
    !config.subscription.forceTier &&
    !subscription?.stripeSubscriptionId &&
    !subscription?.stripeCustomerId &&
    (!subscription ||
      (subscription.tier === "free" &&
        subscription.status === "free" &&
        subscription.subscriptionType === "free")) &&
    !(await getBestActiveEntitlementGrantForGuild(guildId))
  );
}

function frozenIntroOffer(
  current: PurchaseAttempt | undefined,
): BasicIntroOffer | null {
  if (current?.checkout.metadata?.intro_offer_id !== BASIC_INTRO_OFFER_ID)
    return null;
  const priceId = current.checkout.line_items?.[0]?.price;
  const enrollmentEndsAt =
    current.checkout.metadata.intro_offer_enrollment_ends_at;
  if (!priceId || !enrollmentEndsAt) return null;
  return {
    status: "available",
    ...BASIC_INTRO_TERMS,
    priceId,
    enrollmentEndsAt: String(enrollmentEndsAt),
  };
}

export async function getGuildBasicIntroOffer(params: {
  stripe: StripeClient;
  guildId: string;
  payerId?: string;
  plans?: PaidPlan[];
}): Promise<BasicIntroOffer> {
  const [subscription, current] = await Promise.all([
    getSubscriptionRepository().get(params.guildId),
    getPurchaseRepository().get(params.guildId),
  ]);
  if (!(await serverIsEligible(params.guildId, subscription)))
    return { status: "ineligible" };
  if (current && current.state !== "expired") {
    const frozen = frozenIntroOffer(current);
    if (
      frozen &&
      params.payerId === current.payerId &&
      !current.incidentKey &&
      (current.state === "open" ||
        (current.state === "preparing" &&
          Date.now() - current.createdAt < 29 * 60 * 1000)) &&
      Number(current.checkout.expires_at) * 1000 > Date.now()
    )
      return frozen;
    return { status: "ineligible" };
  }
  if (Object.values(config.stripe.basicIntroOffer).every((value) => !value))
    return { status: "inactive" };
  try {
    return await getBasicIntroOffer({
      stripe: params.stripe,
      plans: params.plans ?? (await getPaidPlans(params.stripe)),
    });
  } catch {
    return { status: "unavailable" };
  }
}

export async function prepareBasicIntroCheckout(params: {
  stripe: StripeClient;
  guildId: string;
  expected: GuildSubscription | undefined;
  checkout: Stripe.Checkout.SessionCreateParams;
  expectedOffer?: ExpectedIntroOffer;
  offerChoice?: IntroOfferChoice;
  current?: PurchaseAttempt;
}): Promise<Stripe.Checkout.SessionCreateParams> {
  const choice = params.offerChoice ?? "automatic";
  const manualPromotion = Boolean(
    params.checkout.discounts?.some((discount) => discount.promotion_code) ||
    params.checkout.metadata?.promo_code,
  );
  const current = params.current;
  if (current) {
    const frozen = frozenIntroOffer(current);
    if ((current.offerChoice ?? "automatic") !== choice) throw choiceRequired();
    if (
      params.expectedOffer &&
      params.expectedOffer !== (frozen ? BASIC_INTRO_OFFER_ID : "none")
    )
      throw changedTerms();
    if (frozen) {
      if (manualPromotion) throw choiceRequired();
      return {
        ...params.checkout,
        discounts: current.checkout.discounts,
        allow_promotion_codes: current.checkout.allow_promotion_codes,
      };
    }
    return params.checkout;
  }
  if (choice === "promotion" && !manualPromotion)
    throw new BillingActionError(
      "BAD_REQUEST",
      "Enter a promotion code before choosing a promotion.",
    );
  let plans: PaidPlan[] = [];
  let offer: BasicIntroOffer = { status: "inactive" };
  if (Object.values(config.stripe.basicIntroOffer).some(Boolean)) {
    try {
      plans = await getPaidPlans(params.stripe);
      offer = await getBasicIntroOffer({ stripe: params.stripe, plans });
    } catch {
      offer = { status: "unavailable" };
    }
  }
  const selectedPrice = params.checkout.line_items?.[0]?.price;
  const basicMonthly = plans.find(
    (plan) => plan.tier === "basic" && plan.interval === "month",
  );
  const relevant =
    selectedPrice === basicMonthly?.priceId ||
    selectedPrice === config.stripe.priceBasic ||
    (!plans.length &&
      params.checkout.metadata?.purchase_tier === "basic" &&
      params.checkout.metadata?.purchase_interval === "month");
  const eligible = await serverIsEligible(params.guildId, params.expected);
  if (
    offer.status === "available" &&
    Date.now() >= Date.parse(offer.enrollmentEndsAt)
  )
    offer = { status: "expired" };
  if (eligible && relevant && offer.status === "unavailable")
    throw unavailableOffer();
  const applies =
    choice === "automatic" &&
    eligible &&
    offer.status === "available" &&
    selectedPrice === offer.priceId;
  if (applies && manualPromotion) throw choiceRequired();
  if (
    params.expectedOffer &&
    params.expectedOffer !== (applies ? BASIC_INTRO_OFFER_ID : "none")
  )
    throw changedTerms();
  const offerMetadata = {
    purchase_offer_choice: choice,
    ...(applies && offer.status === "available"
      ? {
          intro_offer_id: BASIC_INTRO_OFFER_ID,
          intro_offer_coupon_id: config.stripe.basicIntroOffer.couponId,
          intro_offer_portal_configuration_id:
            config.stripe.basicIntroOffer.portalConfigurationId,
          intro_offer_enrollment_ends_at: offer.enrollmentEndsAt,
        }
      : {}),
  };
  return {
    ...params.checkout,
    ...(applies
      ? {
          discounts: [{ coupon: config.stripe.basicIntroOffer.couponId }],
          allow_promotion_codes: undefined,
        }
      : {}),
    metadata: { ...params.checkout.metadata, ...offerMetadata },
    subscription_data: {
      ...params.checkout.subscription_data,
      metadata: {
        ...params.checkout.subscription_data?.metadata,
        ...offerMetadata,
      },
    },
  };
}

export const BASIC_INTRO_PLAN_CHANGE_MESSAGE =
  "Plan changes are available after this billing account's introductory discount ends. You can update payment details or cancel in billing management.";

export function activeBasicIntroDiscount(
  subscription: Stripe.Subscription,
): Stripe.Discount | null {
  const couponId =
    subscription.metadata.intro_offer_coupon_id ||
    config.stripe.basicIntroOffer.couponId;
  const discounts = [
    ...(subscription.discounts ?? []),
    ...subscription.items.data.flatMap((item) => item.discounts ?? []),
  ];
  for (const discount of discounts) {
    if (typeof discount === "string")
      throw new Error("Stripe did not expand subscription discounts");
    const coupon = discount.source.coupon;
    const actualCouponId = typeof coupon === "string" ? coupon : coupon?.id;
    if (
      couponId &&
      actualCouponId === couponId &&
      !discount.promotion_code &&
      (discount.end === null || discount.end > Date.now() / 1000)
    )
      return discount;
  }
  return null;
}

export async function getProviderSubscriptionDetails(
  stripe: StripeClient,
  subscription: Stripe.Subscription,
): Promise<ProviderSubscriptionDetails> {
  const item = subscription.items.data[0];
  if (
    subscription.items.data.length !== 1 ||
    item.quantity !== 1 ||
    !["month", "year"].includes(item.price.recurring?.interval ?? "")
  )
    return { status: "unavailable" };
  const price = item.price;
  const unitAmount = price.unit_amount;
  if (unitAmount === null) return { status: "unavailable" };
  const interval = price.recurring?.interval;
  if (interval !== "month" && interval !== "year")
    return { status: "unavailable" };
  const intro = activeBasicIntroDiscount(subscription);
  const discounts = [
    ...(subscription.discounts ?? []),
    ...(item.discounts ?? []),
  ].filter(
    (value) =>
      typeof value === "string" ||
      value.end === null ||
      value.end > Date.now() / 1000,
  );
  if (
    discounts.length > 1 ||
    discounts.some((value) => typeof value === "string")
  )
    return { status: "unavailable" };
  const discount = discounts[0];
  let discountDetails: Extract<
    ProviderSubscriptionDetails,
    { status: "available" }
  >["discount"] = null;
  let discountedUnitAmount: number | null = null;
  if (discount && typeof discount !== "string") {
    const source = discount.source.coupon;
    const coupon =
      typeof source === "string"
        ? await stripe.coupons.retrieve(source)
        : source;
    if (
      !coupon ||
      coupon.deleted ||
      (coupon.amount_off !== null && coupon.currency !== price.currency)
    )
      return { status: "unavailable" };
    discountDetails = {
      percentOff: coupon.percent_off,
      amountOff: coupon.amount_off,
      durationMonths: coupon.duration_in_months,
      endsAt:
        discount.end === null
          ? null
          : new Date(discount.end * 1000).toISOString(),
      introductory: discount.id === intro?.id,
    };
    discountedUnitAmount = Math.max(
      0,
      Math.round(
        unitAmount * (1 - (coupon.percent_off ?? 0) / 100) -
          (coupon.amount_off ?? 0),
      ),
    );
  }
  return {
    status: "available",
    priceId: price.id,
    currency: price.currency,
    unitAmount: unitAmount,
    discountedUnitAmount,
    interval: interval === "month" ? "month" : "year",
    renewalAt:
      subscription.cancel_at_period_end ||
      ["canceled", "incomplete_expired"].includes(subscription.status)
        ? null
        : new Date(item.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    discount: discountDetails,
    planChangesRestricted: Boolean(intro),
    planChangeRestrictionEndsAt: intro?.end
      ? new Date(intro.end * 1000).toISOString()
      : null,
  };
}

export const SUBSCRIPTION_DISCOUNT_EXPANSIONS = [
  "discounts.source.coupon",
  "items.data.discounts",
];

export async function getBasicIntroCustomerRestriction(
  stripe: StripeClient,
  customerId: string,
  knownSubscription?: Stripe.Subscription,
): Promise<{ configurationId: string; endsAt: string | null } | null> {
  const subscriptions: Stripe.Subscription[] = knownSubscription
    ? [knownSubscription]
    : [];
  let after: string | undefined;
  do {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      expand: ["data.discounts.source.coupon", "data.items.data.discounts"],
      ...(after ? { starting_after: after } : {}),
    });
    for (const subscription of page.data) {
      const owner =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      if (
        owner !== customerId ||
        subscription.livemode !== (config.subscription.stripeMode === "live")
      )
        throw new Error(
          "Stripe customer subscription information does not match",
        );
      subscriptions.push(subscription);
    }
    after = page.has_more ? page.data.at(-1)?.id : undefined;
    if (page.has_more && !after)
      throw new Error("Stripe customer subscription page is incomplete");
  } while (after);
  let configurationId: string | undefined;
  let latestEnd = 0;
  let unknownEnd = false;
  for (const subscription of subscriptions) {
    if (["canceled", "incomplete_expired"].includes(subscription.status))
      continue;
    const discount = activeBasicIntroDiscount(subscription);
    if (!discount) continue;
    configurationId ??=
      subscription.metadata.intro_offer_portal_configuration_id ||
      config.stripe.basicIntroOffer.portalConfigurationId;
    if (discount.end === null) unknownEnd = true;
    else latestEnd = Math.max(latestEnd, discount.end);
  }
  if (configurationId === undefined) return null;
  return {
    configurationId,
    endsAt: unknownEnd ? null : new Date(latestEnd * 1000).toISOString(),
  };
}
