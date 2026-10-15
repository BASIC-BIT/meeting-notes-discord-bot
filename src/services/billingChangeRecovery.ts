import type { StripeClient } from "../types/stripe";
import type {
  BillingChangeOperation,
  BillingChangeRecoveryReceipt,
} from "../types/billingChange";
import {
  changeIdempotency,
  changeMetadata,
  assertFundingOwner,
} from "./billingChangeFunding";
import { changeUnavailable, stripeId } from "./billingChangeProvider";

export function compensationAmounts(total: number, paid: number) {
  const serviceRefund = Math.min(paid, Math.max(0, total));
  return {
    serviceRefund,
    serviceCredit: Math.max(0, total - serviceRefund),
    debtRefund: Math.max(0, paid - serviceRefund),
    balanceReversal: Math.max(0, -total),
  };
}
async function inventory<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) {
    if (result.length >= 10000) throw changeUnavailable();
    result.push(value);
  }
  return result;
}
type Canceling = Extract<BillingChangeOperation, { state: "canceling" }>;
type RecoveryInput = {
  stripe: StripeClient;
  operation: Canceling;
  onProgress: (receipt: BillingChangeRecoveryReceipt) => Promise<void>;
};
export async function compensateChangeFunding(
  input: RecoveryInput,
): Promise<BillingChangeRecoveryReceipt> {
  const { stripe, operation, onProgress } = input;
  const receipt: BillingChangeRecoveryReceipt = { ...operation.recovery };
  const invoiceId = operation.funding?.invoiceId ?? operation.draftInvoiceId;
  if (!invoiceId) return receipt;
  let invoice = await stripe.invoices.retrieve(invoiceId);
  assertFundingOwner(invoice, operation);
  if (invoice.status === "draft") {
    const deleted = await stripe.invoices.del(
      invoice.id,
      {},
      changeIdempotency(operation, "delete-funding"),
    );
    if (!deleted.deleted) throw changeUnavailable();
    return receipt;
  }
  if (invoice.status === "open") {
    try {
      await stripe.invoices.voidInvoice(
        invoice.id,
        {},
        changeIdempotency(operation, "void-funding"),
      );
    } catch {
      /* A payment may have settled concurrently. Re-read before deciding. */
    }
    invoice = await stripe.invoices.retrieve(invoiceId);
    assertFundingOwner(invoice, operation);
  }
  if (invoice.status === "void" && invoice.amount_paid === 0) return receipt;
  if (invoice.status !== "paid" || invoice.amount_remaining !== 0)
    throw changeUnavailable();
  const amounts = compensationAmounts(invoice.total, invoice.amount_paid);
  if (invoice.total > 0) {
    const notes = await inventory(
      stripe.creditNotes.list({ invoice: invoice.id, limit: 100 }),
    );
    const owned = notes.filter(
      (note) =>
        note.metadata?.chronote_change_operation === operation.operationId,
    );
    if (owned.length > 1) throw changeUnavailable();
    const note =
      owned[0] ??
      (await stripe.creditNotes.create(
        {
          invoice: invoice.id,
          amount: invoice.total,
          refund_amount: amounts.serviceRefund,
          credit_amount: amounts.serviceCredit,
          reason: "order_change",
          email_type: "none",
          metadata: changeMetadata(operation),
        },
        changeIdempotency(operation, "reverse-service"),
      ));
    if (
      note.status !== "issued" ||
      stripeId(note.invoice) !== invoice.id ||
      note.amount !== invoice.total ||
      stripeId(note.customer) !== operation.source.customerId ||
      note.livemode !== (operation.mode === "live") ||
      note.refunds.reduce((sum, refund) => sum + refund.amount_refunded, 0) !==
        amounts.serviceRefund
    )
      throw changeUnavailable();
    if (amounts.serviceCredit > 0) {
      const creditId = stripeId(note.customer_balance_transaction);
      if (!creditId) throw changeUnavailable();
      const credit = await stripe.customers.retrieveBalanceTransaction(
        operation.source.customerId,
        creditId,
      );
      if (
        credit.amount !== -amounts.serviceCredit ||
        credit.currency !== invoice.currency
      )
        throw changeUnavailable();
    }
    receipt.creditNoteId = note.id;
    await onProgress({ ...receipt });
  }
  if (amounts.debtRefund > 0) {
    const payment = await fundingPayment(
      stripe,
      operation,
      invoice.id,
      invoice.amount_paid,
    );
    const refunds = await inventory(
      stripe.refunds.list({ charge: payment.chargeId, limit: 100 }),
    );
    const owned = refunds.filter(
      (refund) =>
        refund.metadata?.chronote_change_operation === operation.operationId &&
        refund.metadata.chronote_refund_role === "prior-balance",
    );
    if (owned.length > 1) throw changeUnavailable();
    const refund =
      owned[0] ??
      (await stripe.refunds.create(
        {
          charge: payment.chargeId,
          amount: amounts.debtRefund,
          reason: "requested_by_customer",
          metadata: {
            ...changeMetadata(operation),
            chronote_refund_role: "prior-balance",
          },
        },
        changeIdempotency(operation, "reverse-prior-balance-cash"),
      ));
    if (
      refund.status !== "succeeded" ||
      refund.amount !== amounts.debtRefund ||
      stripeId(refund.charge) !== payment.chargeId ||
      refund.currency !== invoice.currency
    )
      throw changeUnavailable();
    receipt.debtRefundId = refund.id;
    await onProgress({ ...receipt });
    receipt.balanceTransactionId = await reverseOwnedBalance(
      stripe,
      operation,
      amounts.debtRefund,
      "prior-balance",
      invoice.id,
    );
    await onProgress({ ...receipt });
  }
  if (amounts.balanceReversal > 0) {
    receipt.balanceTransactionId = await reverseOwnedBalance(
      stripe,
      operation,
      amounts.balanceReversal,
      "negative-service",
      invoice.id,
    );
    await onProgress({ ...receipt });
  }
  return receipt;
}
async function fundingPayment(
  stripe: StripeClient,
  operation: Canceling,
  invoiceId: string,
  amount: number,
) {
  const payments = await inventory(
    stripe.invoicePayments.list({ invoice: invoiceId, limit: 100 }),
  );
  const paid = payments.filter(
    (payment) => payment.status === "paid" && payment.amount_paid,
  );
  if (
    paid.length !== 1 ||
    paid[0].amount_paid !== amount ||
    paid[0].payment.type !== "payment_intent"
  )
    throw changeUnavailable();
  const intentId = stripeId(paid[0].payment.payment_intent);
  if (!intentId) throw changeUnavailable();
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const chargeId = stripeId(intent.latest_charge);
  if (
    !chargeId ||
    intent.livemode !== (operation.mode === "live") ||
    stripeId(intent.customer) !== operation.source.customerId ||
    intent.amount_received !== amount ||
    intent.status !== "succeeded"
  )
    throw changeUnavailable();
  return { intentId, chargeId };
}
async function reverseOwnedBalance(
  stripe: StripeClient,
  operation: Canceling,
  amount: number,
  role: string,
  invoiceId: string,
) {
  const transactions = await inventory(
    stripe.customers.listBalanceTransactions(operation.source.customerId, {
      limit: 100,
    }),
  );
  const owned = transactions.filter(
    (transaction) =>
      transaction.metadata?.chronote_change_operation ===
        operation.operationId &&
      transaction.metadata.chronote_balance_role === role,
  );
  if (
    owned.length > 1 ||
    owned.some((transaction) => transaction.amount !== amount)
  )
    throw changeUnavailable();
  if (owned[0]) return owned[0].id;
  const automatic = transactions.filter(
    (transaction) =>
      stripeId(transaction.invoice) === invoiceId &&
      transaction.type === "unapplied_from_invoice" &&
      transaction.amount > 0,
  );
  if (automatic.length) {
    if (automatic.length !== 1 || automatic[0].amount !== amount)
      throw changeUnavailable();
    return automatic[0].id;
  }
  const transaction = await stripe.customers.createBalanceTransaction(
    operation.source.customerId,
    {
      amount,
      currency: operation.target.currency,
      description: "Reverse canceled Chronote plan change",
      metadata: {
        ...changeMetadata(operation),
        chronote_balance_role: role,
        chronote_funding_invoice: invoiceId,
      },
    },
    changeIdempotency(operation, `restore-${role}`),
  );
  if (
    transaction.amount !== amount ||
    transaction.currency !== operation.target.currency
  )
    throw changeUnavailable();
  return transaction.id;
}
