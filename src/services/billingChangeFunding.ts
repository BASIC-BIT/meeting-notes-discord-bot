import type {
  StripeClient,
  StripeInvoice,
  StripeSubscription,
} from "../types/stripe";
import type {
  BillingChangeOperation,
  BillingChangeFunding,
} from "../types/billingChange";
import { stripeId, changeUnavailable } from "./billingChangeProvider";

export const changeIdempotency = (
  operation: BillingChangeOperation,
  step: string,
) => ({
  idempotencyKey: `chronote_change_${operation.mode}_${operation.operationId}_${step}`,
});
export const changeMetadata = (operation: BillingChangeOperation) => ({
  guild_id: operation.guildId,
  chronote_change_operation: operation.operationId,
});
export function assertFundingOwner(
  invoice: StripeInvoice,
  operation: BillingChangeOperation,
) {
  if (
    stripeId(invoice.customer) !== operation.source.customerId ||
    invoice.livemode !== (operation.mode === "live") ||
    invoice.currency !== operation.target.currency ||
    invoice.metadata?.chronote_change_operation !== operation.operationId ||
    invoice.metadata.guild_id !== operation.guildId ||
    invoice.metadata.chronote_invoice_role !== "funding" ||
    invoice.parent?.subscription_details ||
    invoice.auto_advance
  )
    throw changeUnavailable();
}
export async function createChangeFundingDraft(input: {
  stripe: StripeClient;
  operation: BillingChangeOperation;
  subscription: StripeSubscription;
}) {
  const { stripe, operation, subscription } = input;
  if (subscription.automatic_tax.enabled)
    throw new Error(
      "Automatic-tax plan changes require verified automatic-tax settlement support",
    );
  const invoice = await stripe.invoices.create(
    {
      customer: operation.source.customerId,
      auto_advance: false,
      collection_method: "charge_automatically",
      pending_invoice_items_behavior: "exclude",
      discounts: "",
      default_tax_rates: (subscription.default_tax_rates ?? []).map(
        (rate) => rate.id,
      ),
      default_payment_method: stripeId(subscription.default_payment_method),
      metadata: {
        ...changeMetadata(operation),
        chronote_invoice_role: "funding",
      },
      description: "Chronote plan change",
    },
    changeIdempotency(operation, "funding-draft"),
  );
  assertFundingOwner(invoice, operation);
  if (invoice.status !== "draft") throw changeUnavailable();
  return invoice.id;
}
export async function finalizeChangeFunding(input: {
  stripe: StripeClient;
  operation: BillingChangeOperation;
  subscription: StripeSubscription;
}) {
  const { stripe, operation } = input;
  if (!operation.draftInvoiceId) throw changeUnavailable();
  let invoice = await stripe.invoices.retrieve(operation.draftInvoiceId);
  assertFundingOwner(invoice, operation);
  if (invoice.lines.has_more) throw changeUnavailable();
  if (invoice.status === "draft") {
    const parts = [
      {
        role: "target-service",
        amount: operation.quote.planCharge - operation.quote.offerSavings,
        description: operation.quote.chargeLabel,
      },
      {
        role: "unused-service",
        amount: -operation.quote.unusedCredit,
        description: operation.quote.creditLabel,
      },
    ].filter((part) => part.amount !== 0);
    for (const part of parts) {
      const existing = invoice.lines.data.filter(
        (line) => line.metadata?.chronote_change_part === part.role,
      );
      if (
        existing.length > 1 ||
        existing.some((line) => line.amount !== part.amount)
      )
        throw changeUnavailable();
      if (!existing.length)
        await stripe.invoiceItems.create(
          {
            customer: operation.source.customerId,
            invoice: invoice.id,
            currency: operation.target.currency,
            amount: part.amount,
            tax_behavior: operation.target.taxBehavior,
            discountable: false,
            description: part.description,
            metadata: {
              ...changeMetadata(operation),
              chronote_change_part: part.role,
            },
          },
          changeIdempotency(operation, `funding-${part.role}`),
        );
    }
    invoice = await stripe.invoices.finalizeInvoice(
      invoice.id,
      { auto_advance: false },
      changeIdempotency(operation, "funding-finalize"),
    );
  }
  assertFundingOwner(invoice, operation);
  if (invoice.status !== "open" && invoice.status !== "paid")
    throw changeUnavailable();
  const taxAmount = (invoice.total_taxes ?? []).reduce(
    (sum, tax) => sum + tax.amount,
    0,
  );
  const funding: BillingChangeFunding = {
    invoiceId: invoice.id,
    total: invoice.total,
    amountDue: invoice.amount_due,
    currency: invoice.currency,
    startingBalance: invoice.starting_balance,
    endingBalance: invoice.ending_balance ?? 0,
    serviceValue:
      operation.quote.planCharge -
      operation.quote.offerSavings -
      operation.quote.unusedCredit +
      (operation.quote.taxTreatment === "added"
        ? operation.quote.taxAmount
        : 0),
  };
  return {
    funding,
    quote: {
      ...operation.quote,
      amountDue: funding.amountDue,
      taxAmount,
      billingBalance:
        invoice.total > 0
          ? invoice.amount_due +
            Math.max(0, invoice.ending_balance ?? 0) -
            invoice.total
          : Math.max(0, invoice.starting_balance),
      balanceCarriedForward: Math.max(0, invoice.ending_balance ?? 0),
      remainingCredit: Math.max(0, -(invoice.ending_balance ?? 0)),
    },
  };
}
export function verifyChangeFunding(
  invoice: StripeInvoice,
  operation: BillingChangeOperation,
  funding: BillingChangeFunding,
): boolean {
  try {
    assertFundingOwner(invoice, operation);
  } catch {
    return false;
  }
  return (
    invoice.id === funding.invoiceId &&
    invoice.total === funding.total &&
    invoice.amount_due === funding.amountDue &&
    invoice.currency === funding.currency &&
    invoice.starting_balance === funding.startingBalance &&
    invoice.status === "paid" &&
    invoice.amount_remaining === 0 &&
    invoice.amount_paid === funding.amountDue &&
    invoice.pre_payment_credit_notes_amount === 0 &&
    invoice.post_payment_credit_notes_amount === 0
  );
}
