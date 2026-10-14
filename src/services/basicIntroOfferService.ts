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
  BillingInterval,
  FirstYearPayment,
  ExpectedIntroOffer,
  IntroOfferChoice,
  PaidPlan,
  ProviderSubscriptionDetails,
} from "../types/pricing";
import type { StripeClient } from "../types/stripe";
import { config } from "./configService";

const CHECKOUT_LIFETIME_SECONDS = 3600;
export const BASIC_INTRO_OFFER_ID = "basic_intro_v1";
export const BASIC_ANNUAL_INTRO_OFFER_ID = "basic_annual_intro_v1";
const BASIC_INTRO_TERMS = {
  id: BASIC_INTRO_OFFER_ID,
  currency: "usd",
  regularUnitAmount: 1000,
  discountedUnitAmount: 600,
  percentOff: 40,
  durationMonths: 3,
} as const;
const BASIC_ANNUAL_INTRO_TERMS = {
  id: BASIC_ANNUAL_INTRO_OFFER_ID,
  currency: "usd",
  regularUnitAmount: 10000,
  discountedUnitAmount: 6000,
  percentOff: 40,
  durationMonths: 12,
} as const;

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

function unsupportedIntroPrice(
  price: Stripe.Price,
  plan: PaidPlan,
  interval: BillingInterval,
  terms: typeof BASIC_INTRO_TERMS | typeof BASIC_ANNUAL_INTRO_TERMS,
  live: boolean,
): boolean {
  return Boolean(
    price.lookup_key !==
      (interval === "year"
        ? config.stripe.lookupKeys.basicAnnual
        : config.stripe.lookupKeys.basicMonthly) ||
    price.transform_quantity ||
    !price.active ||
    price.id !== plan.priceId ||
    price.livemode !== live ||
    price.currency !== terms.currency ||
    price.unit_amount !== terms.regularUnitAmount ||
    price.billing_scheme !== "per_unit" ||
    price.type !== "recurring" ||
    price.recurring?.interval !== interval ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed",
  );
}

function couponRedemptionEndsTooSoon(
  redeemBy: number | null,
  enrollmentEnd: number | null,
): boolean {
  return (
    redeemBy !== null &&
    (enrollmentEnd === null ||
      !Number.isFinite(redeemBy) ||
      redeemBy < Math.ceil(enrollmentEnd / 1000) + CHECKOUT_LIFETIME_SECONDS)
  );
}

function unsupportedIntroCoupon(
  coupon: Stripe.Coupon | Stripe.DeletedCoupon,
  couponId: string,
  live: boolean,
  interval: BillingInterval,
  productId: string,
  end: number | null,
  percentOff: number,
): boolean {
  return Boolean(
    coupon.deleted ||
    coupon.id !== couponId ||
    !coupon.valid ||
    coupon.livemode !== live ||
    coupon.percent_off !== percentOff ||
    coupon.amount_off !== null ||
    coupon.currency !== null ||
    coupon.duration !== (interval === "year" ? "once" : "repeating") ||
    coupon.duration_in_months !== (interval === "year" ? null : 3) ||
    couponRedemptionEndsTooSoon(coupon.redeem_by, end) ||
    (coupon.applies_to && !coupon.applies_to.products.includes(productId)),
  );
}

function introEnrollmentWindow(
  settings: typeof config.stripe.basicIntroOffer,
  couponId: string,
):
  | { status: "unavailable" }
  | {
      status: "valid";
      start: number;
      end: number | null;
      enrollmentEndsAt: string | null;
    } {
  if (
    [couponId, settings.startsAt, settings.portalConfigurationId].some(
      (value) => !value.trim(),
    )
  )
    return { status: "unavailable" };
  const enrollmentEndsAt = settings.enrollmentEndsAt.trim() || null;
  if (
    !z.iso.datetime({ offset: true }).safeParse(settings.startsAt).success ||
    (enrollmentEndsAt !== null &&
      !z.iso.datetime({ offset: true }).safeParse(enrollmentEndsAt).success)
  )
    return { status: "unavailable" };
  const start = Date.parse(settings.startsAt);
  const end = enrollmentEndsAt === null ? null : Date.parse(enrollmentEndsAt);
  if (
    !Number.isFinite(start) ||
    (end !== null && (!Number.isFinite(end) || start >= end))
  )
    return { status: "unavailable" };
  return { status: "valid", start, end, enrollmentEndsAt };
}

function introCampaign(params: { interval?: BillingInterval; now?: number }):
  | { status: "inactive" | "unavailable" | "expired" }
  | {
      status: "configured";
      settings: typeof config.stripe.basicIntroOffer;
      interval: BillingInterval;
      terms: typeof BASIC_INTRO_TERMS | typeof BASIC_ANNUAL_INTRO_TERMS;
      couponId: string;
      enrollmentEndsAt: string | null;
      end: number | null;
    } {
  const settings = { ...config.stripe.basicIntroOffer };
  const interval = params.interval ?? "month";
  const terms =
    interval === "year" ? BASIC_ANNUAL_INTRO_TERMS : BASIC_INTRO_TERMS;
  const couponId =
    interval === "year" ? settings.annualCouponId : settings.couponId;
  if (!couponId && (interval === "year" || settings.annualCouponId))
    return { status: "inactive" };
  const values = Object.values(settings);
  if (values.every((value) => !value)) return { status: "inactive" };
  const window = introEnrollmentWindow(settings, couponId);
  if (window.status === "unavailable") return window;
  const { start, end, enrollmentEndsAt } = window;
  const now = params.now ?? Date.now();
  if (now < start) return { status: "inactive" };
  if (end !== null && now >= end) return { status: "expired" };
  return {
    status: "configured" as const,
    settings,
    interval,
    terms,
    couponId,
    enrollmentEndsAt,
    end,
  };
}

export async function getBasicIntroOffer(params: {
  stripe: StripeClient;
  plans: PaidPlan[];
  now?: number;
  interval?: BillingInterval;
}): Promise<BasicIntroOffer> {
  const campaign = introCampaign(params);
  if (campaign.status !== "configured") return campaign;
  const { settings, interval, terms, couponId, enrollmentEndsAt, end } =
    campaign;
  const plan = params.plans.find(
    (candidate) =>
      candidate.tier === "basic" && candidate.interval === interval,
  );
  if (
    !plan ||
    plan.currency !== terms.currency ||
    plan.unitAmount !== terms.regularUnitAmount
  )
    return { status: "unavailable" };
  try {
    const [price, coupon] = await Promise.all([
      params.stripe.prices.retrieve(plan.priceId),
      params.stripe.coupons.retrieve(couponId, {
        expand: ["applies_to"],
      }),
      verifyBasicIntroPortalConfiguration(
        params.stripe,
        settings.portalConfigurationId,
      ),
    ]);
    const live = config.subscription.stripeMode === "live";
    if (unsupportedIntroPrice(price, plan, interval, terms, live))
      return { status: "unavailable" };
    const productId =
      typeof price.product === "string" ? price.product : price.product.id;
    if (
      unsupportedIntroCoupon(
        coupon,
        couponId,
        live,
        interval,
        productId,
        end,
        terms.percentOff,
      )
    )
      return { status: "unavailable" };
    if (end !== null && (params.now ?? Date.now()) >= end)
      return { status: "expired" };
    return {
      status: "available",
      ...terms,
      priceId: price.id,
      enrollmentEndsAt,
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
  const id = current?.checkout.metadata?.intro_offer_id;
  if (
    !current ||
    (id !== BASIC_INTRO_OFFER_ID && id !== BASIC_ANNUAL_INTRO_OFFER_ID)
  )
    return null;
  const priceId = current.checkout.line_items?.[0]?.price;
  const enrollmentEndsAt =
    current.checkout.metadata?.intro_offer_enrollment_ends_at;
  if (!priceId) return null;
  return {
    status: "available",
    ...(id === BASIC_ANNUAL_INTRO_OFFER_ID
      ? BASIC_ANNUAL_INTRO_TERMS
      : BASIC_INTRO_TERMS),
    priceId,
    enrollmentEndsAt: enrollmentEndsAt ? String(enrollmentEndsAt) : null,
  };
}

function canReuseFrozenIntroOffer(
  frozen: BasicIntroOffer | null,
  current: PurchaseAttempt,
  interval: BillingInterval,
  payerId: string | undefined,
): frozen is Extract<BasicIntroOffer, { status: "available" }> {
  return Boolean(
    frozen?.status === "available" &&
    frozen.id ===
      (interval === "year"
        ? BASIC_ANNUAL_INTRO_OFFER_ID
        : BASIC_INTRO_OFFER_ID) &&
    payerId === current.payerId &&
    !current.incidentKey &&
    (current.state === "open" ||
      (current.state === "preparing" &&
        Date.now() - current.createdAt < 29 * 60 * 1000)) &&
    Number(current.checkout.expires_at) * 1000 > Date.now(),
  );
}

function introIntervalIsUnconfigured(
  interval: BillingInterval | undefined,
): boolean {
  return Boolean(
    Object.values(config.stripe.basicIntroOffer).every((value) => !value) ||
    (interval === "year" && !config.stripe.basicIntroOffer.annualCouponId) ||
    ((interval ?? "month") === "month" &&
      !config.stripe.basicIntroOffer.couponId &&
      config.stripe.basicIntroOffer.annualCouponId),
  );
}

export async function getGuildBasicIntroOffer(params: {
  stripe: StripeClient;
  guildId: string;
  payerId?: string;
  plans?: PaidPlan[];
  interval?: BillingInterval;
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
      canReuseFrozenIntroOffer(
        frozen,
        current,
        params.interval ?? "month",
        params.payerId,
      )
    )
      return frozen;
    return { status: "ineligible" };
  }
  if (introIntervalIsUnconfigured(params.interval))
    return { status: "inactive" };
  try {
    return await getBasicIntroOffer({
      stripe: params.stripe,
      interval: params.interval,
      plans: params.plans ?? (await getPaidPlans(params.stripe)),
    });
  } catch {
    return { status: "unavailable" };
  }
}

async function selectedPriceInterval(
  stripe: StripeClient,
  priceId: string | undefined,
): Promise<BillingInterval | null> {
  if (!priceId) throw unavailableOffer();
  try {
    const price = await stripe.prices.retrieve(priceId);
    const lookup = config.stripe.lookupKeys;
    const matches = [
      { key: lookup.basicMonthly, interval: "month", basic: true },
      { key: lookup.basicAnnual, interval: "year", basic: true },
      { key: lookup.proMonthly, interval: "month", basic: false },
      { key: lookup.proAnnual, interval: "year", basic: false },
    ].filter((candidate) => candidate.key === price.lookup_key);
    const match = matches[0];
    if (
      matches.length !== 1 ||
      !match ||
      price.id !== priceId ||
      !price.active ||
      price.livemode !== (config.subscription.stripeMode === "live") ||
      price.type !== "recurring" ||
      price.recurring?.interval_count !== 1 ||
      price.recurring.interval !== match.interval
    )
      throw unavailableOffer();
    return match.basic ? (match.interval === "year" ? "year" : "month") : null;
  } catch {
    throw unavailableOffer();
  }
}

function reuseIntroCheckout(
  current: PurchaseAttempt,
  checkout: Stripe.Checkout.SessionCreateParams,
  choice: IntroOfferChoice,
  expectedOffer: ExpectedIntroOffer | undefined,
  manualPromotion: boolean,
): Stripe.Checkout.SessionCreateParams {
  const frozen = frozenIntroOffer(current);
  if ((current.offerChoice ?? "automatic") !== choice) throw choiceRequired();
  if (
    expectedOffer &&
    expectedOffer !== (frozen?.status === "available" ? frozen.id : "none")
  )
    throw changedTerms();
  if (frozen) {
    if (manualPromotion) throw choiceRequired();
    return {
      ...checkout,
      discounts: current.checkout.discounts,
      allow_promotion_codes: current.checkout.allow_promotion_codes,
    };
  }
  return checkout;
}

async function verifySelectedIntroOffer(
  stripe: StripeClient,
  selectedPrice: string | undefined,
  eligible: boolean,
): Promise<BasicIntroOffer> {
  let offer: BasicIntroOffer = { status: "inactive" };
  if (eligible && Object.values(config.stripe.basicIntroOffer).some(Boolean)) {
    const interval = await selectedPriceInterval(stripe, selectedPrice);
    if (
      interval &&
      (interval === "year"
        ? config.stripe.basicIntroOffer.annualCouponId
        : config.stripe.basicIntroOffer.couponId ||
          !config.stripe.basicIntroOffer.annualCouponId)
    ) {
      try {
        offer = await getBasicIntroOffer({
          stripe: stripe,
          plans: await getPaidPlans(stripe),
          interval,
        });
      } catch {
        offer = { status: "unavailable" };
      }
      if (offer.status === "unavailable") throw unavailableOffer();
      if (offer.status === "available" && offer.priceId !== selectedPrice)
        throw changedTerms();
    }
  }
  return offer;
}

function applyIntroCheckout(
  checkout: Stripe.Checkout.SessionCreateParams,
  offer: BasicIntroOffer,
  choice: IntroOfferChoice,
  applies: boolean,
): Stripe.Checkout.SessionCreateParams {
  const couponId =
    offer.status === "available" && offer.id === BASIC_ANNUAL_INTRO_OFFER_ID
      ? config.stripe.basicIntroOffer.annualCouponId
      : config.stripe.basicIntroOffer.couponId;
  if (
    applies &&
    (checkout.line_items?.length !== 1 ||
      checkout.line_items[0].quantity !== 1 ||
      checkout.discounts?.length)
  )
    throw choiceRequired();
  const offerMetadata = {
    purchase_offer_choice: choice,
    ...(applies && offer.status === "available"
      ? {
          intro_offer_id: offer.id,
          intro_offer_coupon_id: couponId,
          intro_offer_portal_configuration_id:
            config.stripe.basicIntroOffer.portalConfigurationId,
          ...(offer.enrollmentEndsAt
            ? { intro_offer_enrollment_ends_at: offer.enrollmentEndsAt }
            : {}),
        }
      : {}),
  };
  return {
    ...checkout,
    ...(applies
      ? {
          discounts: [{ coupon: couponId }],
          allow_promotion_codes: undefined,
        }
      : {}),
    metadata: { ...checkout.metadata, ...offerMetadata },
    subscription_data: {
      ...checkout.subscription_data,
      metadata: {
        ...checkout.subscription_data?.metadata,
        ...offerMetadata,
      },
    },
  };
}

function acceptIntroQuote(
  choice: IntroOfferChoice,
  eligible: boolean,
  offer: BasicIntroOffer,
  selectedPrice: string | undefined,
  manualPromotion: boolean,
  expectedOffer: ExpectedIntroOffer | undefined,
): boolean {
  const applies =
    choice === "automatic" &&
    eligible &&
    offer.status === "available" &&
    selectedPrice === offer.priceId;
  if (applies && manualPromotion) throw choiceRequired();
  if (
    expectedOffer &&
    expectedOffer !==
      (applies && offer.status === "available" ? offer.id : "none")
  )
    throw changedTerms();
  return applies;
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
  if (current)
    return reuseIntroCheckout(
      current,
      params.checkout,
      choice,
      params.expectedOffer,
      manualPromotion,
    );
  if (choice === "promotion" && !manualPromotion)
    throw new BillingActionError(
      "BAD_REQUEST",
      "Enter a promotion code before choosing a promotion.",
    );
  const settingsBeforeVerification = JSON.stringify(
    config.stripe.basicIntroOffer,
  );
  const selectedPrice = params.checkout.line_items?.[0]?.price;
  const eligible = await serverIsEligible(params.guildId, params.expected);
  let offer = await verifySelectedIntroOffer(
    params.stripe,
    selectedPrice,
    eligible,
  );
  if (
    offer.status === "available" &&
    offer.enrollmentEndsAt !== null &&
    Date.now() >= Date.parse(offer.enrollmentEndsAt)
  )
    offer = { status: "expired" };
  if (
    JSON.stringify(config.stripe.basicIntroOffer) !== settingsBeforeVerification
  )
    throw unavailableOffer();
  const applies = acceptIntroQuote(
    choice,
    eligible,
    offer,
    selectedPrice,
    manualPromotion,
    params.expectedOffer,
  );
  return applyIntroCheckout(params.checkout, offer, choice, applies);
}

export const BASIC_INTRO_PLAN_CHANGE_MESSAGE =
  "Plan changes are available after this billing account's introductory discount ends. You can update payment details or cancel in billing management.";

export function activeBasicIntroDiscount(
  subscription: Stripe.Subscription,
): Stripe.Discount | null {
  const couponIds = subscription.metadata.intro_offer_coupon_id
    ? [subscription.metadata.intro_offer_coupon_id]
    : [
        config.stripe.basicIntroOffer.couponId,
        config.stripe.basicIntroOffer.annualCouponId,
      ];
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
      actualCouponId &&
      couponIds.includes(actualCouponId) &&
      !discount.promotion_code &&
      (discount.end === null || discount.end > Date.now() / 1000)
    )
      return discount;
  }
  return null;
}

// Pure evidence predicate: preserve the short-circuit order of the full native
// first-year invoice contract. Retrieval and display classification stay outside.
function hasUnsupportedAnnualPaymentEvidence(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  referenceId: string,
  discount: Stripe.Discount | Stripe.DeletedDiscount,
  coupon: Stripe.Coupon | Stripe.DeletedCoupon | null,
  expectedLivemode: boolean,
): boolean {
  const item = subscription.items.data[0];
  const invoiceSubscription =
    invoice.parent?.subscription_details?.subscription;
  const owner =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  const subscriptionOwner =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const line = invoice.lines.data[0];
  const lineParent = line?.parent?.subscription_item_details;
  const priceReference = line?.pricing?.price_details?.price;
  const priceId =
    typeof priceReference === "string" ? priceReference : priceReference?.id;
  const lineDiscount = line?.discount_amounts?.[0];
  const invoiceDiscount = invoice.total_discount_amounts?.[0];
  const lineDiscountId =
    typeof lineDiscount?.discount === "string"
      ? lineDiscount.discount
      : lineDiscount?.discount.id;
  const invoiceDiscountId =
    typeof invoiceDiscount?.discount === "string"
      ? invoiceDiscount.discount
      : invoiceDiscount?.discount.id;
  const termDays = line ? (line.period.end - line.period.start) / 86400 : 0;
  return Boolean(
    invoice.id !== referenceId ||
    (typeof invoiceSubscription === "string"
      ? invoiceSubscription
      : invoiceSubscription?.id) !== subscription.id ||
    owner !== subscriptionOwner ||
    invoice.livemode !== subscription.livemode ||
    invoice.livemode !== expectedLivemode ||
    invoice.status !== "paid" ||
    invoice.billing_reason !== "subscription_create" ||
    invoice.currency !== "usd" ||
    invoice.subtotal !== 10000 ||
    invoice.total_excluding_tax !== 6000 ||
    !Number.isSafeInteger(invoice.amount_paid) ||
    invoice.amount_paid < 6000 ||
    invoice.amount_paid !== invoice.total ||
    invoice.amount_remaining !== 0 ||
    invoice.starting_balance !== 0 ||
    invoice.ending_balance !== 0 ||
    invoice.pre_payment_credit_notes_amount !== 0 ||
    invoice.post_payment_credit_notes_amount !== 0 ||
    invoice.lines.has_more ||
    invoice.lines.data.length !== 1 ||
    !line ||
    line.invoice !== invoice.id ||
    line.currency !== "usd" ||
    line.livemode !== invoice.livemode ||
    line.subtotal !== 10000 ||
    line.quantity !== 1 ||
    lineParent?.subscription !== subscription.id ||
    lineParent.subscription_item !== item.id ||
    lineParent.proration !== false ||
    priceId !== item.price.id ||
    item.quantity !== 1 ||
    item.price.currency !== "usd" ||
    item.price.unit_amount !== 10000 ||
    item.price.type !== "recurring" ||
    item.price.billing_scheme !== "per_unit" ||
    item.price.transform_quantity ||
    item.price.recurring?.interval !== "year" ||
    item.price.recurring.interval_count !== 1 ||
    item.price.recurring.usage_type !== "licensed" ||
    ![365, 366].includes(termDays) ||
    line.period.start !== item.current_period_start ||
    line.period.end !== item.current_period_end ||
    invoice.discounts.length !== 1 ||
    !coupon ||
    coupon.deleted ||
    coupon.id !== subscription.metadata.intro_offer_coupon_id ||
    coupon.duration !== "once" ||
    coupon.duration_in_months !== null ||
    coupon.percent_off !== 40 ||
    coupon.amount_off !== null ||
    coupon.currency !== null ||
    coupon.livemode !== invoice.livemode ||
    discount.promotion_code ||
    line.discount_amounts?.length !== 1 ||
    lineDiscount?.amount !== 4000 ||
    lineDiscountId !== discount.id ||
    invoice.total_discount_amounts?.length !== 1 ||
    invoiceDiscount?.amount !== 4000 ||
    invoiceDiscountId !== discount.id ||
    line.pretax_credit_amounts?.some((credit) => credit.type !== "discount"),
  );
}

function stripeReferenceId(
  reference: string | { id: string } | null | undefined,
): string | undefined {
  return typeof reference === "string" ? reference : reference?.id;
}
function matchesCurrentInvoiceAssociation(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  referenceId: string,
): boolean {
  return (
    invoice.id === referenceId &&
    stripeReferenceId(invoice.customer) ===
      stripeReferenceId(subscription.customer) &&
    stripeReferenceId(invoice.parent?.subscription_details?.subscription) ===
      subscription.id &&
    invoice.livemode === subscription.livemode &&
    invoice.livemode === (config.subscription.stripeMode === "live")
  );
}
function matchesCurrentInvoiceLine(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
): boolean {
  const line = invoice.lines.data[0];
  const item = subscription.items.data[0];
  if (!line || invoice.lines.has_more || invoice.lines.data.length !== 1)
    return false;
  const parent = line.parent?.subscription_item_details;
  return (
    line.invoice === invoice.id &&
    line.currency === item.price.currency &&
    line.livemode === subscription.livemode &&
    stripeReferenceId(line.pricing?.price_details?.price) === item.price.id &&
    parent?.subscription === subscription.id &&
    parent.subscription_item === item.id &&
    parent.proration === false
  );
}
function hasUndiscountedCurrentTerm(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
): boolean {
  const line = invoice.lines.data[0];
  const item = subscription.items.data[0];
  return (
    item.quantity === 1 &&
    line.quantity === 1 &&
    item.price.unit_amount !== null &&
    line.subtotal === item.price.unit_amount &&
    invoice.subtotal === line.subtotal &&
    !line.discount_amounts?.length &&
    line.period.start === item.current_period_start &&
    line.period.end === item.current_period_end
  );
}
function isVerifiedRegularRenewal(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  referenceId: string,
): boolean {
  if (
    invoice.billing_reason !== "subscription_cycle" ||
    invoice.status !== "paid" ||
    invoice.discounts.length ||
    invoice.total_discount_amounts?.length
  )
    return false;
  return (
    matchesCurrentInvoiceAssociation(invoice, subscription, referenceId) &&
    matchesCurrentInvoiceLine(invoice, subscription) &&
    hasUndiscountedCurrentTerm(invoice, subscription)
  );
}

// A consumed once discount remains on its invoice, not on subscription.discounts.
export async function getAnnualIntroFirstYearPayment(
  stripe: StripeClient,
  subscription: Stripe.Subscription,
): Promise<FirstYearPayment | null> {
  if (subscription.metadata.intro_offer_id !== BASIC_ANNUAL_INTRO_OFFER_ID)
    return null;
  try {
    const reference = subscription.latest_invoice;
    if (!reference || subscription.items.data.length !== 1)
      return { status: "unavailable" };
    const invoice = await stripe.invoices.retrieve(
      typeof reference === "string" ? reference : reference.id,
      { expand: ["discounts.source.coupon"] },
    );
    if (
      isVerifiedRegularRenewal(
        invoice,
        subscription,
        typeof reference === "string" ? reference : reference.id,
      )
    )
      return null;
    const discount = invoice.discounts[0];
    if (!discount || typeof discount === "string")
      return { status: "unavailable" };
    const couponReference = discount.source.coupon;
    const coupon =
      typeof couponReference === "string"
        ? await stripe.coupons.retrieve(couponReference)
        : couponReference;
    if (
      hasUnsupportedAnnualPaymentEvidence(
        invoice,
        subscription,
        typeof reference === "string" ? reference : reference.id,
        discount,
        coupon,
        config.subscription.stripeMode === "live",
      )
    )
      return { status: "unavailable" };
    const line = invoice.lines.data[0];
    return {
      status: "available",
      currency: "usd",
      discountedSubtotal: 6000,
      amountPaid: invoice.amount_paid,
      periodStartsAt: new Date(line.period.start * 1000).toISOString(),
      periodEndsAt: new Date(line.period.end * 1000).toISOString(),
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function scopedSubscriptionCoupon(
  stripe: StripeClient,
  discount: Stripe.Discount,
  price: Stripe.Price,
): Promise<Stripe.Coupon | null> {
  const source = discount.source.coupon;
  let coupon = typeof source === "string" ? null : source;
  const couponId = typeof source === "string" ? source : source?.id;
  if (coupon?.deleted) return null;
  if (!coupon || !coupon.applies_to) {
    if (!couponId) return null;
    try {
      // applies_to is expandable, and omission on the subscription expansion
      // cannot prove that the coupon is unrestricted.
      coupon = await stripe.coupons.retrieve(couponId, {
        expand: ["applies_to"],
      });
    } catch {
      return null;
    }
  }
  if (!coupon || coupon.id !== couponId) return null;
  const productId =
    typeof price.product === "string" ? price.product : price.product?.id;
  if (coupon.applies_to && !productId) return null;
  return coupon;
}

function availableSubscriptionDiscounts(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
): (Stripe.Discount | string)[] | null {
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
    return null;
  return discounts;
}

function couponAppliesToProduct(
  coupon: Stripe.Coupon,
  productId: string | undefined,
): boolean {
  return (
    !coupon.applies_to ||
    Boolean(productId && coupon.applies_to.products.includes(productId))
  );
}

async function subscriptionDiscountDetails(
  stripe: StripeClient,
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
  unitAmount: number,
): Promise<
  | { status: "unavailable" }
  | {
      status: "available";
      intro: Stripe.Discount | null;
      discountDetails: Extract<
        ProviderSubscriptionDetails,
        { status: "available" }
      >["discount"];
      discountedUnitAmount: number | null;
    }
> {
  const price = item.price;
  const intro = activeBasicIntroDiscount(subscription);
  const discounts = availableSubscriptionDiscounts(subscription, item);
  if (!discounts) return { status: "unavailable" };
  const discount = discounts[0];
  let discountDetails: Extract<
    ProviderSubscriptionDetails,
    { status: "available" }
  >["discount"] = null;
  let discountedUnitAmount: number | null = null;
  if (discount && typeof discount !== "string") {
    const coupon = await scopedSubscriptionCoupon(stripe, discount, price);
    if (!coupon) return { status: "unavailable" };
    const productId =
      typeof price.product === "string" ? price.product : price.product?.id;
    if (couponAppliesToProduct(coupon, productId)) {
      if (coupon.amount_off !== null && coupon.currency !== price.currency)
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
  }
  return {
    status: "available" as const,
    intro,
    discountDetails,
    discountedUnitAmount,
  };
}

export async function getProviderSubscriptionDetails(
  stripe: StripeClient,
  subscription: Stripe.Subscription,
): Promise<ProviderSubscriptionDetails> {
  const item = subscription.items.data[0];
  if (
    subscription.items.data.length !== 1 ||
    item.quantity !== 1 ||
    item.price.recurring?.interval_count !== 1 ||
    !["month", "year"].includes(item.price.recurring?.interval ?? "")
  )
    return { status: "unavailable" };
  const price = item.price;
  const unitAmount = price.unit_amount;
  if (unitAmount === null) return { status: "unavailable" };
  const interval = price.recurring?.interval;
  if (interval !== "month" && interval !== "year")
    return { status: "unavailable" };
  const result = await subscriptionDiscountDetails(
    stripe,
    subscription,
    item,
    unitAmount,
  );
  if (result.status === "unavailable") return { status: "unavailable" };
  const { intro, discountDetails, discountedUnitAmount } = result;
  return {
    status: "available",
    priceId: price.id,
    currency: price.currency,
    unitAmount: unitAmount,
    discountedUnitAmount,
    interval: interval === "month" ? "month" : "year",
    renewalAt: ["canceled", "incomplete_expired"].includes(subscription.status)
      ? null
      : new Date(item.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    discount: discountDetails,
    firstYearPayment: await getAnnualIntroFirstYearPayment(
      stripe,
      subscription,
    ),
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

async function customerSubscriptions(
  stripe: StripeClient,
  customerId: string,
  knownSubscription: Stripe.Subscription | undefined,
): Promise<Stripe.Subscription[]> {
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
  return subscriptions;
}

export async function getBasicIntroCustomerRestriction(
  stripe: StripeClient,
  customerId: string,
  knownSubscription?: Stripe.Subscription,
): Promise<{ configurationId: string; endsAt: string | null } | null> {
  const subscriptions = await customerSubscriptions(
    stripe,
    customerId,
    knownSubscription,
  );
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
