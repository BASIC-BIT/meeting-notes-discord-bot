import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type {
  StripeClient,
  StripeInvoice,
  StripeSubscription,
} from "../types/stripe";
import {
  renewalRecoveryKey,
  type RenewalRecovery,
} from "../types/renewalRecovery";
import { assertRenewalOwner } from "./renewalRecoveryEvidence";
import { changeUnavailable, stripeId } from "./billingChangeProvider";
import { inventory } from "./billingChangeRecovery";
import { releaseOwnedSchedule } from "./billingChangeSchedule";
import { getBillingChangeRepository } from "../repositories/billingChangeRepository";
import { config } from "./configService";

type Canceling = Extract<RenewalRecovery, { state: "canceling" }>;
type Input = {
  stripe: StripeClient;
  recovery: RenewalRecovery;
  now: number;
  onReceipt(next: RenewalRecovery): Promise<void>;
};
function assertInvoice(invoice: StripeInvoice, record: Canceling): void {
  const lines = invoice.lines.data.filter(
    (line) => line.id === record.invoice.lineId,
  );
  const line = lines[0];
  if (
    invoice.id !== record.invoice.id ||
    stripeId(invoice.customer) !== record.customerId ||
    invoice.livemode !== (record.mode === "live") ||
    stripeId(invoice.parent?.subscription_details?.subscription) !==
      record.subscriptionId ||
    invoice.lines.has_more ||
    lines.length !== 1 ||
    line.quantity !== 1 ||
    line.parent?.subscription_item_details?.subscription !==
      record.subscriptionId ||
    line.period.start !== record.invoice.periodStart ||
    line.period.end !== record.invoice.periodEnd
  )
    throw changeUnavailable();
}
function noteAmounts(note: Stripe.CreditNote) {
  const cash = Number(note.metadata?.chronote_recovery_refund);
  const credit = Number(note.metadata?.chronote_recovery_credit);
  if (
    !Number.isSafeInteger(cash) ||
    !Number.isSafeInteger(credit) ||
    cash < 0 ||
    credit < 0 ||
    cash + credit !== note.post_payment_amount
  )
    throw changeUnavailable();
  return { cash, credit };
}
function assertCreditNote(
  note: Stripe.CreditNote,
  invoice: StripeInvoice,
  record: Canceling,
): void {
  if (
    note.status !== "issued" ||
    note.metadata?.chronote_renewal_recovery !== renewalRecoveryKey(record) ||
    stripeId(note.invoice) !== invoice.id ||
    stripeId(note.customer) !== record.customerId ||
    note.livemode !== (record.mode === "live") ||
    note.currency !== invoice.currency ||
    note.amount <= 0 ||
    note.lines.has_more ||
    note.lines.data.length !== 1 ||
    note.lines.data[0].invoice_line_item !== record.invoice.lineId ||
    note.lines.data[0].quantity !== 1
  )
    throw changeUnavailable();
}
async function paidCharge(
  stripe: StripeClient,
  invoice: StripeInvoice,
  record: Canceling,
): Promise<string> {
  const payments = (
    await inventory(
      stripe.invoicePayments.list({
        invoice: invoice.id,
        status: "paid",
        limit: 100,
      }),
    )
  ).filter((payment) => (payment.amount_paid ?? 0) > 0);
  if (
    payments.length !== 1 ||
    payments[0].livemode !== invoice.livemode ||
    payments[0].currency !== invoice.currency ||
    stripeId(payments[0].invoice) !== invoice.id ||
    payments[0].payment.type !== "payment_intent"
  )
    throw changeUnavailable();
  const intentId = stripeId(payments[0].payment.payment_intent);
  if (!intentId) throw changeUnavailable();
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const charge = stripeId(intent.latest_charge);
  if (
    !charge ||
    intent.status !== "succeeded" ||
    intent.livemode !== invoice.livemode ||
    stripeId(intent.customer) !== record.customerId ||
    intent.currency !== invoice.currency ||
    intent.amount_received !== payments[0].amount_paid
  )
    throw changeUnavailable();
  return charge;
}
async function verifyCreditNoteMoney(
  stripe: StripeClient,
  invoice: StripeInvoice,
  record: Canceling,
  note: Stripe.CreditNote,
): Promise<string[]> {
  const amounts = noteAmounts(note);
  const refunded = note.refunds.reduce(
    (sum, entry) => sum + entry.amount_refunded,
    0,
  );
  if (refunded !== amounts.cash) throw changeUnavailable();
  const charge =
    amounts.cash > 0 ? await paidCharge(stripe, invoice, record) : null;
  const refunds: string[] = [];
  for (const entry of note.refunds) {
    const id = stripeId(entry.refund);
    if (!id) throw changeUnavailable();
    const refund = await stripe.refunds.retrieve(id);
    if (
      refund.status !== "succeeded" ||
      refund.currency !== invoice.currency ||
      refund.amount !== entry.amount_refunded ||
      stripeId(refund.charge) !== charge
    )
      throw changeUnavailable();
    refunds.push(id);
  }
  if (amounts.credit > 0) {
    const id = stripeId(note.customer_balance_transaction);
    if (!id) throw changeUnavailable();
    const credit = await stripe.customers.retrieveBalanceTransaction(
      record.customerId,
      id,
    );
    if (
      credit.amount !== -amounts.credit ||
      credit.currency !== invoice.currency
    )
      throw changeUnavailable();
  }
  return refunds;
}
async function inFlightPayment(
  stripe: StripeClient,
  invoice: StripeInvoice,
  record: Canceling,
): Promise<boolean> {
  for (const payment of await inventory(
    stripe.invoicePayments.list({
      invoice: invoice.id,
      status: "open",
      limit: 100,
    }),
  )) {
    if (payment.status !== "open") continue;
    if (
      stripeId(payment.invoice) !== invoice.id ||
      payment.livemode !== invoice.livemode ||
      payment.payment.type !== "payment_intent"
    )
      throw changeUnavailable();
    const id = stripeId(payment.payment.payment_intent);
    if (!id) throw changeUnavailable();
    const intent = await stripe.paymentIntents.retrieve(id);
    if (
      stripeId(intent.customer) !== record.customerId ||
      intent.livemode !== invoice.livemode
    )
      throw changeUnavailable();
    if (intent.status === "processing") return true;
  }
  return false;
}
async function ownedCreditNote(
  stripe: StripeClient,
  invoice: StripeInvoice,
  record: Canceling,
): Promise<Stripe.CreditNote | undefined> {
  const notes = await inventory(
    stripe.creditNotes.list({ invoice: invoice.id, limit: 100 }),
  );
  const owned = notes.filter(
    (note) =>
      note.metadata?.chronote_renewal_recovery === renewalRecoveryKey(record),
  );
  if (
    owned.length > 1 ||
    (record.receipts.creditNoteId &&
      owned[0]?.id !== record.receipts.creditNoteId)
  )
    throw changeUnavailable();
  if (owned[0]) return owned[0];
  if (
    invoice.pre_payment_credit_notes_amount ||
    invoice.post_payment_credit_notes_amount
  )
    throw changeUnavailable();
  return undefined;
}
async function createPlanCreditNote(
  stripe: StripeClient,
  invoice: StripeInvoice,
  record: Canceling,
): Promise<Stripe.CreditNote> {
  const lines: Stripe.CreditNoteCreateParams.Line[] = [
    {
      type: "invoice_line_item",
      invoice_line_item: record.invoice.lineId,
      quantity: 1,
    },
  ];
  const preview = await stripe.creditNotes.preview({
    invoice: invoice.id,
    lines,
  });
  if (
    preview.amount <= 0 ||
    preview.currency !== invoice.currency ||
    preview.post_payment_amount < 0
  )
    throw changeUnavailable();
  const cash = Math.min(invoice.amount_paid, preview.post_payment_amount);
  const credit = preview.post_payment_amount - cash;
  if (cash > 0) await paidCharge(stripe, invoice, record);
  return stripe.creditNotes.create(
    {
      invoice: invoice.id,
      lines,
      refund_amount: cash || undefined,
      credit_amount: credit || undefined,
      reason: "order_change",
      email_type: "none",
      metadata: {
        chronote_renewal_recovery: renewalRecoveryKey(record),
        chronote_recovery_refund: String(cash),
        chronote_recovery_credit: String(credit),
      },
    },
    {
      idempotencyKey: `${renewalRecoveryKey(record)}:credit:${cash}:${credit}`,
    },
  );
}
async function releaseRenewalSchedule(
  stripe: StripeClient,
  subscription: StripeSubscription,
  record: Canceling,
): Promise<void> {
  const scheduleId = stripeId(subscription.schedule);
  if (!scheduleId) return;
  if (!record.scheduledOperationId) throw changeUnavailable();
  const operation = await getBillingChangeRepository().getOperation(
    record.guildId,
    record.scheduledOperationId,
  );
  if (
    !operation ||
    operation.source.subscriptionId !== record.subscriptionId ||
    operation.source.customerId !== record.customerId ||
    operation.mode !== record.mode
  )
    throw changeUnavailable();
  if (!(await releaseOwnedSchedule(stripe, operation, scheduleId)))
    throw changeUnavailable();
}
async function restoreCollection(
  stripe: StripeClient,
  record: Canceling,
): Promise<void> {
  for (const before of record.receipts.unrelatedInvoices) {
    if (!before.autoAdvance) continue;
    let invoice = await stripe.invoices.retrieve(before.id);
    if (
      stripeId(invoice.customer) !== record.customerId ||
      invoice.livemode !== (record.mode === "live")
    )
      throw changeUnavailable();
    if (
      invoice.status !== "open" ||
      invoice.amount_remaining <= 0 ||
      invoice.auto_advance
    )
      continue;
    invoice = await stripe.invoices.update(
      invoice.id,
      { auto_advance: true },
      { idempotencyKey: `${renewalRecoveryKey(record)}:restore:${invoice.id}` },
    );
    if (!invoice.auto_advance) throw changeUnavailable();
  }
}
export async function cancelUnpaidRenewal(
  input: Input,
): Promise<"paid" | "canceled" | "pending"> {
  if (
    input.recovery.state !== "canceling" ||
    input.recovery.mode !== config.subscription.stripeMode
  )
    throw changeUnavailable();
  const stripe = input.stripe;
  let record = input.recovery;
  const save = async (receipts: Canceling["receipts"]) => {
    const next = { ...record, revision: randomUUID(), receipts };
    await input.onReceipt(next);
    record = next;
    return next;
  };
  const subscription = await stripe.subscriptions.retrieve(
    record.subscriptionId,
  );
  assertRenewalOwner(subscription, record);
  const customer = await stripe.customers.retrieve(record.customerId);
  if (
    customer.deleted ||
    customer.livemode !== (record.mode === "live") ||
    customer.metadata.discord_id !== record.payerId
  )
    throw changeUnavailable();
  const debt = await settleRenewalDebt(stripe, record, save);
  if (debt !== "cleared") return debt;
  await cancelVerifiedSubscription(stripe, subscription, record);
  await save({ ...record.receipts, canceled: true });
  await restoreCollection(stripe, record);
  await save({ ...record.receipts, collectionRestored: true });
  return "canceled";
}

async function settleRenewalDebt(
  stripe: StripeClient,
  record: Canceling,
  save: (receipts: Canceling["receipts"]) => Promise<Canceling>,
): Promise<"paid" | "pending" | "cleared"> {
  let invoice = await stripe.invoices.retrieve(record.invoice.id);
  assertInvoice(invoice, record);
  let note = await ownedCreditNote(stripe, invoice, record);
  if (!note && invoice.status === "paid" && invoice.amount_remaining === 0)
    return "paid";
  if (!note && (await inFlightPayment(stripe, invoice, record)))
    return "pending";
  record = await snapshotCollection(stripe, invoice, record, save);
  if (!note && invoice.status !== "void") {
    await stripe.invoices.update(
      invoice.id,
      { auto_advance: false },
      { idempotencyKey: `${renewalRecoveryKey(record)}:pause-invoice` },
    );
    invoice = await stripe.invoices.retrieve(invoice.id);
    assertInvoice(invoice, record);
    if (invoice.status === "paid" && invoice.amount_remaining === 0)
      return "paid";
    if (await inFlightPayment(stripe, invoice, record)) return "pending";
    note = await createPlanCreditNote(stripe, invoice, record);
  }
  if (note) {
    assertCreditNote(note, invoice, record);
    const refundIds = await verifyCreditNoteMoney(
      stripe,
      invoice,
      record,
      note,
    );
    await save({ ...record.receipts, creditNoteId: note.id, refundIds });
  } else if (invoice.status !== "void" || invoice.amount_paid !== 0)
    throw changeUnavailable();
  return "cleared";
}
async function snapshotCollection(
  stripe: StripeClient,
  invoice: StripeInvoice,
  record: Canceling,
  save: (receipts: Canceling["receipts"]) => Promise<Canceling>,
): Promise<Canceling> {
  if (!record.receipts.unrelatedInvoices.length) {
    const invoices = await inventory(
      stripe.invoices.list({ customer: record.customerId, limit: 100 }),
    );
    const snapshots = [
      invoice,
      ...invoices.filter((value) => value.id !== invoice.id),
    ].filter((value) => value.status === "open" || value.status === "draft");
    return save({
      ...record.receipts,
      unrelatedInvoices: snapshots.map((value) => ({
        id: value.id,
        autoAdvance: value.auto_advance === true,
      })),
    });
  }
  return record;
}
async function cancelVerifiedSubscription(
  stripe: StripeClient,
  subscription: StripeSubscription,
  record: Canceling,
): Promise<void> {
  await releaseRenewalSchedule(stripe, subscription, record);
  subscription = await stripe.subscriptions.retrieve(record.subscriptionId);
  assertRenewalOwner(subscription, record);
  if (subscription.status !== "canceled") {
    subscription = await stripe.subscriptions.update(
      subscription.id,
      { metadata: { chronote_renewal_recovery: renewalRecoveryKey(record) } },
      { idempotencyKey: `${renewalRecoveryKey(record)}:mark-cancellation` },
    );
    assertRenewalOwner(subscription, record);
    subscription = await stripe.subscriptions.cancel(
      subscription.id,
      { invoice_now: false, prorate: false },
      { idempotencyKey: `${renewalRecoveryKey(record)}:cancel` },
    );
  }
  assertRenewalOwner(subscription, record);
  if (
    subscription.status !== "canceled" ||
    subscription.metadata.chronote_renewal_recovery !==
      renewalRecoveryKey(record)
  )
    throw changeUnavailable();
}
