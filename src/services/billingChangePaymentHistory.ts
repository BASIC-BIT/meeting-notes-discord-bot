import type { StripeClient, StripeSubscription } from "../types/stripe";
import type { FirstYearPayment } from "../types/pricing";
import { getBillingChangeRepository } from "../repositories/billingChangeRepository";
import { verifyChangeFunding } from "./billingChangeFunding";
import { stripeId } from "./billingChangeProvider";
import { assertFirstOfferInvoice } from "./firstOfferInvoiceEvidence";
export async function readChangedAnnualPayment(
  stripe: StripeClient,
  subscription: StripeSubscription,
): Promise<FirstYearPayment | null | undefined> {
  const operationId = subscription.metadata.chronote_change_operation;
  if (!operationId) return undefined;
  const operation = await getBillingChangeRepository().getOperation(
    subscription.metadata.guild_id,
    operationId,
  );
  if (!operation || operation.state !== "succeeded")
    return { status: "unavailable" };
  if (operation.target.offer?.id !== "basic_annual_intro_v1") return null;
  if (!sameAnnualPeriod(subscription, operation)) return null;
  if (!samePaymentOwner(subscription, operation))
    return { status: "unavailable" };
  if (!operation.service) return null;
  const invoice = await stripe.invoices.retrieve(
    operation.funding?.invoiceId ?? operation.service.invoiceId,
    { expand: ["discounts.source.coupon"] },
  );
  if (operation.funding) {
    if (!verifyChangeFunding(invoice, operation, operation.funding))
      return { status: "unavailable" };
  } else {
    assertFirstOfferInvoice(
      invoice,
      subscription.id,
      operation.target.offer.terms,
      "subscription_cycle",
    );
    if (
      invoice.status !== "paid" ||
      invoice.amount_remaining !== 0 ||
      stripeId(invoice.customer) !== operation.source.customerId
    )
      return { status: "unavailable" };
  }
  return {
    status: "available",
    currency: "usd",
    discountedSubtotal: 6000,
    amountPaid: invoice.amount_paid,
    periodStartsAt: new Date(
      operation.service.periodStart * 1000,
    ).toISOString(),
    periodEndsAt: new Date(operation.service.periodEnd * 1000).toISOString(),
  };
}

function sameAnnualPeriod(
  subscription: StripeSubscription,
  operation: Extract<
    import("../types/billingChange").BillingChangeOperation,
    { state: "succeeded" }
  >,
) {
  const item = subscription.items.data[0];
  return (
    operation.service &&
    item.price.id === operation.target.priceId &&
    item.current_period_start === operation.service.periodStart &&
    item.current_period_end === operation.service.periodEnd
  );
}
function samePaymentOwner(
  subscription: StripeSubscription,
  operation: import("../types/billingChange").BillingChangeOperation,
) {
  return (
    subscription.id === operation.source.subscriptionId &&
    stripeId(subscription.customer) === operation.source.customerId &&
    subscription.livemode === (operation.mode === "live")
  );
}
