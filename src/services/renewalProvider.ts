import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type {
  StripeClient,
  StripeSubscription,
  StripeInvoice,
} from "../types/stripe";
import type { RenewalOperation, RenewalTerms } from "../types/renewal";
import { renewalTermsSchema } from "../types/renewal";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { config } from "./configService";
import { BillingActionError } from "./billingActionError";
import { resolveTierFromPrice } from "./pricingService";
import { resolveSubscriptionCancellationAt } from "../utils/stripeCancellation";
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type ReviewReason =
  "unsupported_state" | "payment_problem" | "unverified_terms";
type Identity = {
  subscription: StripeSubscription;
  customer: Stripe.Customer;
  cancellationAt: number | null;
};
export type RenewalSource =
  | (Identity & { kind: "terminal" })
  | (Identity & { kind: "review"; reason: ReviewReason })
  | (Identity & {
      kind: "verified";
      terms: RenewalTerms;
      sourceFingerprint: string;
      invariantFingerprint: string;
      stripeRequest: RenewalOperation["stripeRequest"];
    });
export async function readRenewalSource({
  stripe,
  guildId,
  subscriptionId,
}: {
  stripe: StripeClient;
  guildId: string;
  subscriptionId: string;
}): Promise<RenewalSource> {
  const saved = await getSubscriptionRepository().get(guildId);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["discounts.source.coupon", "latest_invoice"],
  });
  const customerId = id(subscription.customer);
  if (
    !saved ||
    saved.stripeSubscriptionId !== subscriptionId ||
    subscription.id !== subscriptionId ||
    !customerId ||
    (saved.stripeCustomerId && saved.stripeCustomerId !== customerId) ||
    subscription.metadata.guild_id !== guildId ||
    subscription.livemode !== (config.subscription.stripeMode === "live")
  )
    throw new BillingActionError(
      "BAD_REQUEST",
      "Server billing information does not match Stripe; contact support",
    );
  const customer = await stripe.customers.retrieve(customerId);
  if (
    customer.deleted ||
    customer.id !== customerId ||
    customer.livemode !== subscription.livemode
  )
    throw new BillingActionError(
      "BAD_REQUEST",
      "Server billing information is unavailable",
    );
  const identity: Identity = {
    subscription,
    customer,
    cancellationAt: resolveSubscriptionCancellationAt(subscription),
  };
  if (
    subscription.status === "canceled" ||
    subscription.status === "incomplete_expired"
  )
    return { ...identity, kind: "terminal" };
  const review = (reason: ReviewReason): RenewalSource => ({
    ...identity,
    kind: "review",
    reason,
  });
  if (subscription.status !== "active") return review("payment_problem");
  const item = subscription.items.data[0];
  if (
    identity.cancellationAt !== null &&
    !supportedCancellationShape(subscription)
  )
    return review("unsupported_state");
  if (
    subscription.items.has_more ||
    subscription.items.data.length !== 1 ||
    !item ||
    item.quantity !== 1 ||
    subscription.schedule ||
    subscription.billing_schedules.length ||
    subscription.pending_update ||
    subscription.pause_collection ||
    subscription.trial_end ||
    subscription.pending_setup_intent ||
    subscription.collection_method !== "charge_automatically"
  )
    return review("unsupported_state");
  const price = item.price;
  const recurring = price.recurring;
  const tier = resolveTierFromPrice({
    priceId: price.id,
    lookupKey: price.lookup_key,
  });
  if (
    !tier ||
    !recurring ||
    !["month", "year"].includes(recurring.interval) ||
    recurring.interval_count !== 1 ||
    recurring.usage_type !== "licensed" ||
    price.billing_scheme !== "per_unit" ||
    price.unit_amount === null ||
    !Number.isSafeInteger(price.unit_amount) ||
    price.unit_amount < 0 ||
    price.currency !== "usd" ||
    price.currency !== subscription.currency ||
    price.livemode !== subscription.livemode ||
    (price.tax_behavior !== "exclusive" && price.tax_behavior !== "inclusive")
  )
    return review("unverified_terms");
  const invoiceId = id(subscription.latest_invoice);
  if (!invoiceId) return review("unverified_terms");
  const invoice = await stripe.invoices
    .retrieve(invoiceId)
    .catch(() => undefined);
  if (!invoice) return review("unverified_terms");
  if (!isFundedPeriod(invoice, subscription, item.id, customer.id))
    return review("payment_problem");
  const paidLine = invoice.lines.data.find(
    (line) =>
      line.parent?.type === "subscription_item_details" &&
      line.parent.subscription_item_details?.subscription_item === item.id &&
      !line.parent.subscription_item_details.proration &&
      line.pricing?.price_details?.price === price.id,
  );
  if (
    !paidLine ||
    paidLine.amount !== price.unit_amount ||
    paidLine.quantity !== 1 ||
    paidLine.period.start !== item.current_period_start ||
    paidLine.period.end !== item.current_period_end ||
    (identity.cancellationAt !== null &&
      identity.cancellationAt !== paidLine.period.end)
  )
    return review("unverified_terms");
  const stripeRequest: RenewalOperation["stripeRequest"] =
    subscription.billing_mode.type === "classic"
      ? { cancel_at_period_end: false, proration_behavior: "none" }
      : { cancel_at: "", proration_behavior: "none" };
  const preview = await stripe.invoices
    .createPreview({
      subscription: subscription.id,
      subscription_details: stripeRequest,
    })
    .catch(() => undefined);
  if (!preview) return review("unverified_terms");
  const terms = previewTerms(preview, subscription, tier, paidLine.period.end);
  if (!terms) return review("unverified_terms");
  const invariant = {
    subscriptionId: subscription.id,
    customerId: customer.id,
    payer: customer.metadata.discord_id,
    balance: customer.balance,
    mode: subscription.livemode,
    billingMode: subscription.billing_mode,
    billingSchedules: subscription.billing_schedules,
    itemId: item.id,
    priceId: price.id,
    priceAmount: price.unit_amount,
    currency: price.currency,
    taxBehavior: price.tax_behavior,
    recurring,
    quantity: item.quantity,
    periodStart: item.current_period_start,
    periodEnd: item.current_period_end,
    anchor: subscription.billing_cycle_anchor,
    anchorConfig: subscription.billing_cycle_anchor_config,
    discounts: subscription.discounts,
    itemDiscounts: item.discounts,
    defaultTaxRates: subscription.default_tax_rates,
    itemTaxRates: item.tax_rates,
    automaticTax: subscription.automatic_tax,
    paymentMethod: id(subscription.default_payment_method),
    defaultSource: id(subscription.default_source),
    customerPaymentMethod: id(customer.invoice_settings.default_payment_method),
    customerDefaultSource: id(customer.default_source),
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    schedule: id(subscription.schedule),
    pendingUpdate: subscription.pending_update,
    pause: subscription.pause_collection,
    terms,
  };
  const invariantFingerprint = digest(invariant);
  return {
    ...identity,
    kind: "verified",
    terms,
    stripeRequest,
    invariantFingerprint,
    sourceFingerprint: digest({
      invariantFingerprint,
      cancelAt: subscription.cancel_at,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at,
    }),
  };
}
function supportedCancellationShape(subscription: StripeSubscription) {
  return subscription.billing_mode.type === "classic"
    ? subscription.cancel_at_period_end
    : !subscription.cancel_at_period_end && subscription.cancel_at !== null;
}
function isFundedPeriod(
  invoice: StripeInvoice,
  subscription: StripeSubscription,
  itemId: string,
  customerId: string,
) {
  return (
    cashInvoiceSettled(invoice) &&
    invoiceMatchesSubscription(invoice, subscription, customerId) &&
    fundedInvoiceLineMatches(invoice, itemId)
  );
}
function cashInvoiceSettled(invoice: StripeInvoice) {
  return (
    invoice.status === "paid" &&
    invoice.post_payment_credit_notes_amount === 0 &&
    invoice.pre_payment_credit_notes_amount === 0 &&
    invoice.amount_paid > 0 &&
    invoice.amount_remaining === 0 &&
    ["subscription_create", "subscription_cycle"].includes(
      invoice.billing_reason ?? "",
    )
  );
}
function invoiceMatchesSubscription(
  invoice: StripeInvoice,
  subscription: StripeSubscription,
  customerId: string,
) {
  return (
    invoice.currency === subscription.currency &&
    invoice.livemode === subscription.livemode &&
    id(invoice.customer) === customerId &&
    id(invoice.parent?.subscription_details?.subscription) === subscription.id
  );
}
function fundedInvoiceLineMatches(invoice: StripeInvoice, itemId: string) {
  return (
    !invoice.lines.has_more &&
    invoice.lines.data.length === 1 &&
    invoice.lines.data[0].parent?.subscription_item_details
      ?.subscription_item === itemId
  );
}
function previewTerms(
  preview: StripeInvoice,
  subscription: StripeSubscription,
  tier: RenewalTerms["tier"],
  boundary: number,
): RenewalTerms | undefined {
  const item = subscription.items.data[0];
  const line = preview.lines.data[0];
  const price = item.price;
  if (
    preview.livemode !== subscription.livemode ||
    id(preview.customer) !== id(subscription.customer) ||
    preview.currency !== price.currency ||
    preview.lines.has_more ||
    preview.lines.data.length !== 1 ||
    !line ||
    line.parent?.type !== "subscription_item_details" ||
    line.parent.subscription_item_details?.subscription_item !== item.id ||
    line.parent.subscription_item_details.proration ||
    line.pricing?.price_details?.price !== price.id ||
    line.quantity !== 1 ||
    line.period.start !== boundary ||
    line.period.end <= boundary ||
    line.amount !== price.unit_amount
  )
    return undefined;
  if (line.taxes?.some((tax) => tax.tax_behavior !== price.tax_behavior))
    return undefined;
  const discounts = line.discount_amounts ?? [];
  if (
    discounts.length > 1 ||
    subscription.discounts.length > 1 ||
    item.discounts.length
  )
    return undefined;
  const discountAmount = discounts.reduce(
    (sum, discount) => sum + discount.amount,
    0,
  );
  const currentDiscount = subscription.discounts[0];
  let discount: RenewalTerms["discount"] = null;
  if (discountAmount > 0) {
    if (
      !currentDiscount ||
      typeof currentDiscount === "string" ||
      !currentDiscount.end ||
      currentDiscount.end <= boundary ||
      id(discounts[0]?.discount) !== currentDiscount.id
    )
      return undefined;
    discount = {
      endsAt: iso(currentDiscount.end),
      regularUnitAmount: line.amount,
    };
  }
  const parsed = renewalTermsSchema.safeParse({
    tier,
    interval: price.recurring?.interval,
    currency: price.currency,
    unitAmount: line.amount - discountAmount,
    taxBehavior: price.tax_behavior,
    renewsAt: iso(boundary),
    discount,
  });
  return parsed.success ? parsed.data : undefined;
}
export async function clearPendingCancellation({
  stripe,
  operation,
}: {
  stripe: StripeClient;
  operation: RenewalOperation;
}): Promise<void> {
  if (!config.stripe.renewalReactivationEnabled)
    throw new BillingActionError(
      "BAD_REQUEST",
      "Direct renewal is unavailable",
    );
  await stripe.subscriptions.update(
    operation.subscriptionId,
    operation.stripeRequest,
    { idempotencyKey: operation.idempotencyKey },
  );
}
