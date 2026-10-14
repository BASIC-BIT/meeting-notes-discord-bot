import { assertSessionAssociation } from "./purchaseSession";
import { randomUUID } from "node:crypto";
import type {
  StripeClient,
  StripeInvoice,
  StripeSubscription,
} from "../types/stripe";
import type { PurchaseAttempt } from "../types/purchase";
import { getOfferUsageRepository } from "../repositories/offerUsageRepository";
import {
  introOfferIdSchema,
  type OfferUsage,
  type OfferUsageMutation,
} from "../types/offerUsage";

type ReservedOffer = Extract<OfferUsage, { state: "reserved" }>;
const referenceId = (reference: string | { id: string } | null | undefined) =>
  typeof reference === "string" ? reference : reference?.id;
const invalid = () =>
  new Error("Offer settlement evidence does not match the reserved purchase");

export type InitialOfferSettlement =
  | { kind: "none" }
  | { kind: "pending"; invoiceId: string }
  | { kind: "settled"; invoiceId: string; usage: OfferUsageMutation };
export type SettlementInvoice = { invoiceId: string };

export async function prepareInitialOfferSettlement(
  stripe: StripeClient,
  attempt: PurchaseAttempt,
  subscription: StripeSubscription,
  hint?: SettlementInvoice,
): Promise<InitialOfferSettlement> {
  const id = introOfferIdSchema.safeParse(
    attempt.checkout.metadata?.intro_offer_id,
  );
  if (!id.success) return { kind: "none" };
  const expected = await getOfferUsageRepository().get(
    attempt.guildId,
    id.data,
    attempt.mode,
  );
  if (
    !expected ||
    expected.state === "unused" ||
    expected.operationId !== attempt.attemptId
  )
    throw invalid();
  if (expected.state === "used") return { kind: "none" };
  assertSubscriptionScope(attempt, subscription, expected);
  const invoice = await readInitialOfferInvoice(
    stripe,
    attempt,
    subscription,
    hint,
  );
  if (!invoice) return { kind: "none" };
  if (
    invoice.status !== "paid" ||
    ["incomplete", "incomplete_expired"].includes(subscription.status)
  )
    return { kind: "pending", invoiceId: invoice.id };
  assertFirstOfferInvoice(invoice, subscription, expected);
  const paidAt = invoice.status_transitions.paid_at;
  if (
    paidAt === null ||
    !Number.isInteger(paidAt) ||
    !Number.isInteger(invoice.amount_paid) ||
    invoice.amount_paid < 0 ||
    invoice.amount_remaining !== 0
  )
    throw invalid();
  return {
    kind: "settled",
    invoiceId: invoice.id,
    usage: {
      expected,
      next: {
        ...expected,
        revision: randomUUID(),
        state: "used",
        usedAt: Date.now(),
        settlement: {
          customerId: attempt.customerId,
          subscriptionId: subscription.id,
          subscriptionItemId:
            invoice.lines.data[0].parent?.subscription_item_details
              ?.subscription_item,
          invoiceId: invoice.id,
          priceId: expected.terms.priceId,
          status: "paid",
          amountPaid: invoice.amount_paid,
          amountRemaining: 0,
          settledAt: paidAt * 1000,
        },
      },
    },
  };
}
async function readInitialOfferInvoice(
  stripe: StripeClient,
  attempt: PurchaseAttempt,
  subscription: StripeSubscription,
  hint: SettlementInvoice | undefined,
): Promise<StripeInvoice | undefined> {
  const reference =
    attempt.initialInvoiceId ??
    hint?.invoiceId ??
    referenceId(subscription.latest_invoice);
  if (!reference) return undefined;
  const invoice = await readAssociatedInvoice(
    stripe,
    reference,
    attempt,
    subscription,
  );
  if (invoice.billing_reason === "subscription_create") return invoice;
  if (attempt.initialInvoiceId || !attempt.sessionId) throw invalid();
  const session = await stripe.checkout.sessions.retrieve(attempt.sessionId);
  assertSessionAssociation(attempt, session);
  const initialInvoiceId = referenceId(session.invoice);
  if (
    session.status !== "complete" ||
    referenceId(session.subscription) !== subscription.id ||
    !initialInvoiceId
  )
    throw invalid();
  const initial = await readAssociatedInvoice(
    stripe,
    initialInvoiceId,
    attempt,
    subscription,
  );
  if (initial.billing_reason !== "subscription_create") throw invalid();
  return initial;
}
async function readAssociatedInvoice(
  stripe: StripeClient,
  invoiceId: string,
  attempt: PurchaseAttempt,
  subscription: StripeSubscription,
) {
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["discounts.source.coupon"],
  });
  assertInvoiceScope(invoice, invoiceId, attempt, subscription);
  return invoice;
}
function assertSubscriptionScope(
  attempt: PurchaseAttempt,
  subscription: StripeSubscription,
  offer: ReservedOffer,
) {
  if (
    subscription.metadata.guild_id !== attempt.guildId ||
    subscription.metadata.purchase_attempt_id !== attempt.attemptId ||
    subscription.metadata.intro_offer_id !== offer.offerId ||
    subscription.metadata.intro_offer_coupon_id !== offer.terms.couponId ||
    referenceId(subscription.customer) !== attempt.customerId ||
    subscription.livemode !== (attempt.mode === "live")
  )
    throw invalid();
}
function assertInvoiceScope(
  invoice: StripeInvoice,
  invoiceId: string,
  attempt: PurchaseAttempt,
  subscription: StripeSubscription,
) {
  if (
    invoice.id !== invoiceId ||
    invoice.livemode !== (attempt.mode === "live") ||
    referenceId(invoice.customer) !== attempt.customerId ||
    referenceId(invoice.parent?.subscription_details?.subscription) !==
      subscription.id ||
    invoice.currency !== "usd"
  )
    throw invalid();
}
function assertFirstOfferInvoice(
  invoice: StripeInvoice,
  subscription: StripeSubscription,
  offer: ReservedOffer,
) {
  if (
    invoice.billing_reason !== "subscription_create" ||
    invoice.lines.has_more ||
    invoice.lines.data.length !== 1 ||
    invoice.discounts.length !== 1 ||
    invoice.total_discount_amounts?.length !== 1 ||
    invoice.subtotal !== offer.terms.regularUnitAmount
  )
    throw invalid();
  const discount = invoice.discounts[0];
  if (
    typeof discount === "string" ||
    discount.source.type !== "coupon" ||
    referenceId(discount.source.coupon) !== offer.terms.couponId
  )
    throw invalid();
  const expectedDiscount =
    offer.terms.regularUnitAmount - offer.terms.discountedUnitAmount;
  const totalDiscount = invoice.total_discount_amounts[0];
  if (
    totalDiscount.amount !== expectedDiscount ||
    referenceId(totalDiscount.discount) !== discount.id
  )
    throw invalid();
  assertInvoiceLine(
    invoice,
    subscription,
    offer,
    discount.id,
    expectedDiscount,
  );
}
function assertInvoiceLine(
  invoice: StripeInvoice,
  subscription: StripeSubscription,
  offer: ReservedOffer,
  discountId: string,
  expectedDiscount: number,
) {
  const line = invoice.lines.data[0];
  const parent = line.parent?.subscription_item_details;
  if (
    line.invoice !== invoice.id ||
    line.livemode !== invoice.livemode ||
    line.currency !== offer.terms.currency ||
    line.quantity !== 1 ||
    line.amount !== offer.terms.regularUnitAmount ||
    referenceId(line.pricing?.price_details?.price) !== offer.terms.priceId
  )
    throw invalid();
  if (
    !parent ||
    parent.subscription !== subscription.id ||
    !parent.subscription_item ||
    parent.proration ||
    !Number.isInteger(line.period.start) ||
    !Number.isInteger(line.period.end) ||
    line.period.end <= line.period.start
  )
    throw invalid();
  assertLineDiscount(line, discountId, expectedDiscount);
}

function assertLineDiscount(
  line: StripeInvoice["lines"]["data"][number],
  discountId: string,
  expectedDiscount: number,
) {
  if (
    line.discount_amounts?.length !== 1 ||
    line.discount_amounts[0].amount !== expectedDiscount ||
    referenceId(line.discount_amounts[0].discount) !== discountId
  )
    throw invalid();
}
