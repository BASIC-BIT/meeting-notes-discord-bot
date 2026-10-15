import type Stripe from "stripe";
import type {
  StripeClient,
  StripeInvoice,
  StripeSubscription,
} from "../types/stripe";
import type { BillingChangeOperation } from "../types/billingChange";
import {
  changeSourceFingerprint,
  changeUpdateParams,
  stripeId,
  changeUnavailable,
} from "./billingChangeProvider";
import {
  changeIdempotency,
  changeMetadata,
  verifyChangeFunding,
} from "./billingChangeFunding";

type Applying = Extract<BillingChangeOperation, { state: "applying" }>;
export function buildChangeApplicationRequest(
  operation: Applying,
): Stripe.SubscriptionUpdateParams {
  const reset =
    operation.source.interval !== operation.target.selection.interval;
  const offset = reset
    ? operation.quote.planCharge - operation.quote.offerSavings
    : operation.funding.serviceValue;
  if (!operation.target.productId) throw changeUnavailable();
  return {
    ...changeUpdateParams(operation.source, operation.target, "apply"),
    ...(operation.source.billingMode === "classic"
      ? { cancel_at_period_end: false }
      : { cancel_at: "" }),
    metadata: {
      ...changeMetadata(operation),
      chronote_change_funding: operation.funding.invoiceId,
    },
    add_invoice_items: [
      {
        discountable: false,
        price_data: {
          currency: operation.target.currency,
          product: operation.target.productId,
          unit_amount: -offset,
          tax_behavior: "inclusive",
        },
        metadata: {
          ...changeMetadata(operation),
          chronote_invoice_role: "application-offset",
        },
      },
    ],
    expand: ["latest_invoice", "discounts.source.coupon"],
  };
}
function targetDiscountMatches(
  subscription: StripeSubscription,
  operation: Applying,
) {
  if (!operation.target.offer) return subscription.discounts.length === 0;
  return (
    subscription.discounts.length === 1 &&
    subscription.discounts.every(
      (discount) =>
        typeof discount !== "string" &&
        stripeId(discount.source.coupon) ===
          operation.target.offer?.terms.couponId,
    )
  );
}
export function inspectChangeApplication(
  subscription: StripeSubscription,
  invoice: StripeInvoice,
  operation: Applying,
): "applied" | "residual_balance" | "unknown" {
  const item = subscription.items.data[0];
  if (
    subscription.id !== operation.source.subscriptionId ||
    stripeId(subscription.customer) !== operation.source.customerId ||
    subscription.livemode !== (operation.mode === "live") ||
    subscription.metadata.guild_id !== operation.guildId ||
    subscription.metadata.chronote_change_operation !== operation.operationId ||
    subscription.items.has_more ||
    subscription.items.data.length !== 1 ||
    item.id !== operation.source.itemId ||
    item.price.id !== operation.target.priceId ||
    item.quantity !== 1 ||
    subscription.billing_mode.type !== operation.source.billingMode ||
    !targetDiscountMatches(subscription, operation) ||
    stripeId(invoice.customer) !== operation.source.customerId ||
    invoice.livemode !== subscription.livemode ||
    invoice.currency !== operation.target.currency ||
    stripeId(invoice.parent?.subscription_details?.subscription) !==
      subscription.id ||
    invoice.total !== 0 ||
    invoice.amount_paid !== 0 ||
    invoice.lines.has_more
  )
    return "unknown";
  const reset =
    operation.source.interval !== operation.target.selection.interval;
  if (!reset && item.current_period_end !== operation.source.periodEnd)
    return "unknown";
  if (
    reset &&
    (item.current_period_start < operation.consent.at ||
      item.current_period_start > operation.consent.at + 86400 ||
      item.current_period_end <= item.current_period_start)
  )
    return "unknown";
  if (
    ((invoice.status === "paid" && invoice.amount_remaining === 0) ||
      invoice.status === "void") &&
    subscription.status === "active" &&
    !subscription.pending_update
  )
    return "applied";
  if (
    invoice.status === "open" &&
    invoice.starting_balance > 0 &&
    invoice.amount_due === invoice.starting_balance &&
    invoice.amount_remaining === invoice.amount_due &&
    !invoice.auto_advance &&
    invoice.attempt_count === 0 &&
    invoice.next_payment_attempt === null
  )
    return "residual_balance";
  return "unknown";
}
export async function applyFundedBillingChange(input: {
  stripe: StripeClient;
  operation: Applying;
  now?: number;
}): Promise<"applied" | "source_changed" | "unknown"> {
  const { stripe, operation } = input;
  const funding = await stripe.invoices.retrieve(operation.funding.invoiceId);
  if (!verifyChangeFunding(funding, operation, operation.funding))
    return "unknown";
  let subscription = await stripe.subscriptions.retrieve(
    operation.source.subscriptionId,
    { expand: ["latest_invoice", "discounts.source.coupon"] },
  );
  if (
    subscription.metadata.chronote_change_operation !== operation.operationId
  ) {
    if (
      changeSourceFingerprint(subscription) !== operation.source.fingerprint ||
      (input.now ?? Math.floor(Date.now() / 1000)) >= operation.source.periodEnd
    )
      return "source_changed";
    subscription = await stripe.subscriptions.update(
      subscription.id,
      buildChangeApplicationRequest(operation),
      changeIdempotency(operation, "apply"),
    );
  }
  const invoiceId = stripeId(subscription.latest_invoice);
  if (!invoiceId || invoiceId === operation.funding.invoiceId) return "unknown";
  let invoice = await stripe.invoices.retrieve(invoiceId);
  let result = inspectChangeApplication(subscription, invoice, operation);
  if (result === "residual_balance") {
    await stripe.invoices.voidInvoice(
      invoice.id,
      {},
      changeIdempotency(operation, "void-application-balance"),
    );
    subscription = await stripe.subscriptions.retrieve(subscription.id, {
      expand: ["discounts.source.coupon"],
    });
    invoice = await stripe.invoices.retrieve(invoiceId);
    result = inspectChangeApplication(subscription, invoice, operation);
  }
  return result === "applied" ? "applied" : "unknown";
}
