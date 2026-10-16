import { randomUUID } from "node:crypto";
import type { StripeClient } from "../types/stripe";
import {
  billingChangeOperationSchema,
  billingChangeBase,
  type BillingChangeOperation,
  type BillingChangeView,
  type BillingChangeSelection,
  type BillingChangeWrite,
} from "../types/billingChange";
import { getBillingChangeRepository } from "../repositories/billingChangeRepository";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { getPurchaseRepository } from "../repositories/purchaseAttemptRepository";
import { config } from "./configService";
import { BillingActionError } from "./billingActionError";
import { resolveChangeTiming } from "./billingChangePolicy";
import {
  readBillingChangeSource,
  previewBillingChange,
  changeSourceFingerprint,
  stripeId,
  changeUnavailable,
  changePending,
} from "./billingChangeProvider";
import {
  resolveBillingChangeTarget,
  billingChangeQuote,
  reserveChangeOffer,
  settleChangeOffer,
  releaseChangeOffer,
} from "./billingChangeTerms";
import {
  createChangeFundingDraft,
  finalizeChangeFunding,
  assertFundingOwner,
  verifyChangeFunding,
} from "./billingChangeFunding";
import { applyFundedBillingChange } from "./billingChangeApplication";
import { compensateChangeFunding } from "./billingChangeRecovery";
import {
  scheduleBillingChange,
  cancelChangeSchedule,
  readScheduledChangeSettlement,
} from "./billingChangeSchedule";
import { reconcileSubscription } from "./subscriptionReconciliation";

type Context = {
  stripe: StripeClient;
  guildId: string;
  payerId: string;
  now?: number;
};
const at = (context: Context) => context.now ?? Math.floor(Date.now() / 1000);
const repo = () => getBillingChangeRepository();
async function persist(
  next: BillingChangeOperation,
  previous: BillingChangeOperation,
  usage?: BillingChangeWrite["usage"],
) {
  const parsed = billingChangeOperationSchema.parse(next);
  if (
    !(await repo().compareAndWrite({
      next: parsed,
      expectedRevision: previous.revision,
      usage,
    }))
  )
    throw new BillingActionError(
      "BAD_REQUEST",
      "This change has been updated. Check its status before continuing.",
    );
  return parsed;
}
async function owned(context: Context, operationId?: string) {
  const control = await repo().getControl(context.guildId);
  const id = operationId ?? control?.operationId;
  if (!id) return undefined;
  const operation = await repo().getOperation(context.guildId, id);
  if (!operation) throw changeUnavailable();
  if (operation.payerId !== context.payerId)
    throw new BillingActionError(
      "FORBIDDEN",
      "Only the original payer can manage this change.",
    );
  if (operation.mode !== config.subscription.stripeMode)
    throw changeUnavailable();
  return operation;
}
async function verifyPayer(
  context: Context,
  operation: BillingChangeOperation,
) {
  const customer = await context.stripe.customers.retrieve(
    operation.source.customerId,
  );
  if (
    customer.deleted ||
    customer.livemode !== (operation.mode === "live") ||
    customer.metadata.discord_id !== context.payerId
  )
    throw new BillingActionError(
      "FORBIDDEN",
      "Only the original payer can manage this subscription.",
    );
}
async function present(
  context: Context,
  operation: BillingChangeOperation,
): Promise<BillingChangeView> {
  let paymentUrl: string | null = null;
  if (operation.state === "accepted" && operation.funding) {
    const invoice = await context.stripe.invoices.retrieve(
      operation.funding.invoiceId,
    );
    assertFundingOwner(invoice, operation);
    if (
      invoice.status === "open" &&
      invoice.amount_due === operation.funding.amountDue &&
      invoice.total === operation.funding.total
    )
      paymentUrl = invoice.hosted_invoice_url ?? null;
  }
  return {
    kind: "operation",
    operationId: operation.operationId,
    revision: operation.revision,
    state: operation.state,
    quote: operation.quote,
    paymentUrl,
  };
}
export async function prepareBillingChange(
  context: Context & { selection: BillingChangeSelection },
): Promise<BillingChangeView> {
  const existing = await owned(context);
  if (existing) return present(context, await resume(context, existing));
  if (!config.stripe.subscriptionTransitionsEnabled)
    throw new BillingActionError(
      "BAD_REQUEST",
      "Plan changes are not available yet.",
    );
  const currentPurchase = await getPurchaseRepository().get(context.guildId);
  if (
    currentPurchase &&
    ["preparing", "open", "needs_review"].includes(currentPurchase.state)
  )
    throw changePending();
  const source = await readBillingChangeSource({ ...context, at: at(context) });
  if (source.subscription.schedule) throw changeUnavailable();
  const timing = resolveChangeTiming({
    sourceTier: source.source.tier,
    sourceInterval: source.source.interval,
    targetTier: context.selection.tier,
    targetInterval: context.selection.interval,
  });
  if (timing === "unchanged") return { kind: "none", enabled: true };
  const target = await resolveBillingChangeTarget(
    context.stripe,
    context.guildId,
    context.payerId,
    context.selection,
    source,
  );
  let quote = billingChangeQuote(source, target, timing);
  if (timing === "immediate") {
    const preview = await previewBillingChange({
      stripe: context.stripe,
      subscription: source.subscription,
      source: source.source,
      target,
    });
    const end = preview.invoice.lines.data.find(
      (line) =>
        line.amount > 0 &&
        line.pricing?.price_details?.price === target.priceId,
    )?.period.end;
    quote = {
      ...billingChangeQuote(source, target, timing),
      planCharge: preview.amounts.planCharge,
      offerSavings: preview.amounts.offerSavings,
      unusedCredit: preview.amounts.unusedCredit,
      taxAmount: preview.amounts.taxAmount,
      amountDue: preview.invoice.amount_due,
      nextAt:
        source.source.interval !== target.selection.interval
          ? null
          : end
            ? new Date(end * 1000).toISOString()
            : quote.nextAt,
    };
  }
  const operation = billingChangeOperationSchema.parse({
    guildId: context.guildId,
    operationId: randomUUID(),
    revision: randomUUID(),
    payerId: context.payerId,
    mode: config.subscription.stripeMode,
    createdAt: at(context),
    expiresAt: at(context) + 600,
    timing,
    source: source.source,
    target,
    quote,
    state: "preparing",
    draftInvoiceId: null,
  });
  const usage = await reserveChangeOffer(operation);
  if (
    !(await repo().claim({
      operation,
      expectedSubscription: source.saved,
      usage,
    }))
  ) {
    const winner = await owned(context);
    if (!winner) throw changeUnavailable();
    return present(context, await resume(context, winner));
  }
  return present(context, await resume(context, operation));
}
export async function readBillingChange(
  context: Context,
): Promise<BillingChangeView> {
  const operation = await owned(context);
  if (!operation)
    return {
      kind: "none",
      enabled: config.stripe.subscriptionTransitionsEnabled,
    };
  return present(context, await resume(context, operation));
}
export async function confirmBillingChange(
  context: Context & { operationId: string; revision: string },
): Promise<BillingChangeView> {
  const operation = await owned(context, context.operationId);
  if (!operation) throw changeUnavailable();
  if (operation.revision !== context.revision)
    throw new BillingActionError(
      "BAD_REQUEST",
      "The review has changed. Check the current price before confirming.",
    );
  if (operation.state !== "review")
    return present(context, await resume(context, operation));
  if (at(context) >= operation.expiresAt)
    return present(
      context,
      await resume(context, await beginCancel(context, operation)),
    );
  await verifyPayer(context, operation);
  const current = await context.stripe.subscriptions.retrieve(
    operation.source.subscriptionId,
    { expand: ["discounts.source.coupon"] },
  );
  const pointer = await getSubscriptionRepository().get(context.guildId);
  if (
    pointer?.stripeSubscriptionId !== operation.source.subscriptionId ||
    changeSourceFingerprint(current) !== operation.source.fingerprint
  )
    return present(
      context,
      await resume(context, await beginCancel(context, operation)),
    );
  const accepted = await persist(
    {
      ...billingChangeBase(operation),
      revision: randomUUID(),
      state: "accepted",
      funding: operation.funding,
      consent: { at: at(context), quoteRevision: operation.revision },
    },
    operation,
  );
  return present(context, await resume(context, accepted));
}
export async function cancelBillingChange(
  context: Context & { operationId: string },
): Promise<BillingChangeView> {
  let operation = await owned(context, context.operationId);
  if (!operation) throw changeUnavailable();
  await verifyPayer(context, operation);
  if (["applying", "preparing", "scheduled"].includes(operation.state))
    operation = await resume(context, operation);
  if (
    operation.state === "succeeded" ||
    operation.state === "canceled" ||
    operation.state === "applying"
  )
    return present(context, operation);
  return present(
    context,
    await resume(context, await beginCancel(context, operation)),
  );
}
async function beginCancel(
  context: Context,
  operation: BillingChangeOperation,
): Promise<BillingChangeOperation> {
  if (
    operation.state === "canceling" ||
    operation.state === "canceled" ||
    operation.state === "succeeded"
  )
    return operation;
  const subscription =
    operation.timing === "renewal"
      ? await context.stripe.subscriptions.retrieve(
          operation.source.subscriptionId,
        )
      : null;
  const scheduleId =
    operation.state === "scheduled"
      ? operation.scheduleId
      : subscription
        ? (stripeId(subscription.schedule) ?? null)
        : null;
  return persist(
    {
      ...billingChangeBase(operation),
      revision: randomUUID(),
      state: "canceling",
      funding: "funding" in operation ? operation.funding : null,
      scheduleId,
      consent: "consent" in operation ? operation.consent : null,
      recovery: {
        creditNoteId: null,
        debtRefundId: null,
        balanceTransactionId: null,
      },
    },
    operation,
  );
}
async function resume(
  context: Context,
  initial: BillingChangeOperation,
): Promise<BillingChangeOperation> {
  let operation = initial;
  for (let step = 0; step < 6; step++) {
    const previousRevision = operation.revision;
    switch (operation.state) {
      case "preparing":
        operation = await prepareInvoice(context, operation);
        break;
      case "accepted":
        operation = await afterAcceptance(context, operation);
        break;
      case "applying":
        operation = await applyPayment(context, operation);
        break;
      case "scheduled":
        operation = await settleScheduled(context, operation);
        break;
      case "canceling":
        operation = await finishCancellation(context, operation);
        break;
      case "review":
        if (at(context) >= operation.expiresAt) {
          operation = await beginCancel(context, operation);
          break;
        }
        return operation;
      case "succeeded":
      case "canceled":
        return operation;
    }
    if (operation.revision === previousRevision) return operation;
  }
  return operation;
}
async function prepareInvoice(
  context: Context,
  operation: Extract<BillingChangeOperation, { state: "preparing" }>,
) {
  const source = await readBillingChangeSource({ ...context, at: at(context) });
  if (
    changeSourceFingerprint(source.subscription) !==
    operation.source.fingerprint
  )
    return beginCancel(context, operation);
  if (operation.timing === "renewal")
    return persist(
      {
        ...billingChangeBase(operation),
        revision: randomUUID(),
        state: "review",
        funding: null,
      },
      operation,
    );
  if (!operation.draftInvoiceId) {
    if (at(context) - operation.createdAt >= 23 * 3600)
      throw changeUnavailable();
    const draftInvoiceId = await createChangeFundingDraft({
      stripe: context.stripe,
      operation,
      subscription: source.subscription,
    });
    return persist(
      { ...operation, revision: randomUUID(), draftInvoiceId },
      operation,
    );
  }
  const prepared = await finalizeChangeFunding({
    stripe: context.stripe,
    operation,
    subscription: source.subscription,
  });
  return persist(
    {
      ...billingChangeBase(operation),
      revision: randomUUID(),
      state: "review",
      ...prepared,
    },
    operation,
  );
}
async function afterAcceptance(
  context: Context,
  operation: Extract<BillingChangeOperation, { state: "accepted" }>,
) {
  await verifyPayer(context, operation);
  const savedPointer = await getSubscriptionRepository().get(context.guildId);
  if (
    savedPointer?.stripeSubscriptionId !== operation.source.subscriptionId ||
    (savedPointer.stripeCustomerId &&
      savedPointer.stripeCustomerId !== operation.source.customerId)
  )
    return beginCancel(context, operation);
  if (operation.timing === "renewal") {
    const scheduleId = await scheduleBillingChange(context.stripe, operation);
    return persist(
      {
        ...billingChangeBase(operation),
        revision: randomUUID(),
        state: "scheduled",
        scheduleId,
        consent: operation.consent,
      },
      operation,
    );
  }
  if (!operation.funding) throw changeUnavailable();
  const pointer = await getSubscriptionRepository().get(context.guildId);
  const subscription = await context.stripe.subscriptions.retrieve(
    operation.source.subscriptionId,
    { expand: ["discounts.source.coupon"] },
  );
  if (
    pointer?.stripeSubscriptionId !== operation.source.subscriptionId ||
    at(context) >= operation.source.periodEnd ||
    changeSourceFingerprint(subscription) !== operation.source.fingerprint
  )
    return beginCancel(context, operation);
  const invoice = await context.stripe.invoices.retrieve(
    operation.funding.invoiceId,
  );
  assertFundingOwner(invoice, operation);
  if (invoice.status === "open") return operation;
  if (invoice.status === "void") return beginCancel(context, operation);
  if (!verifyChangeFunding(invoice, operation, operation.funding))
    throw changeUnavailable();
  return persist(
    {
      ...billingChangeBase(operation),
      revision: randomUUID(),
      state: "applying",
      funding: operation.funding,
      consent: operation.consent,
    },
    operation,
  );
}
async function applyPayment(
  context: Context,
  operation: Extract<BillingChangeOperation, { state: "applying" }>,
) {
  await verifyPayer(context, operation);
  const pointer = await getSubscriptionRepository().get(context.guildId);
  if (
    pointer?.stripeSubscriptionId !== operation.source.subscriptionId ||
    (pointer.stripeCustomerId &&
      pointer.stripeCustomerId !== operation.source.customerId)
  )
    throw changeUnavailable();
  const result = await applyFundedBillingChange({
    stripe: context.stripe,
    operation,
    now: at(context),
  });
  if (result === "rejected") return beginCancel(context, operation);
  if (result === "unknown") return operation;
  const invoice = await context.stripe.invoices.retrieve(
    operation.funding.invoiceId,
  );
  const next = billingChangeOperationSchema.parse({
    ...billingChangeBase(operation),
    revision: randomUUID(),
    state: "succeeded",
    funding: operation.funding,
    scheduleId: null,
    appliedAt: at(context),
    consent: operation.consent,
    service: {
      invoiceId: result.invoice.id,
      periodStart: result.subscription.items.data[0].current_period_start,
      periodEnd: result.subscription.items.data[0].current_period_end,
    },
  });
  const completed = await persist(
    next,
    operation,
    await settleChangeOffer(next, invoice, at(context)),
  );
  await reconcileSubscription(
    context.stripe,
    operation.guildId,
    operation.source.subscriptionId,
  );
  return completed;
}
async function settleScheduled(
  context: Context,
  operation: Extract<
    BillingChangeOperation,
    { state: "scheduled" | "canceling" }
  >,
) {
  if (!operation.consent) return operation;
  const result = await readScheduledChangeSettlement(context.stripe, operation);
  if (result.kind === "waiting") return operation;
  const next = billingChangeOperationSchema.parse({
    ...billingChangeBase(operation),
    revision: randomUUID(),
    state: "succeeded",
    funding: null,
    scheduleId: operation.scheduleId,
    appliedAt: at(context),
    consent: operation.consent,
    ...(result.kind === "paid"
      ? {
          service: {
            invoiceId: result.invoice.id,
            periodStart:
              result.invoice.lines.data.find(
                (line) =>
                  line.pricing?.price_details?.price ===
                  operation.target.priceId,
              )?.period.start ?? operation.source.periodEnd,
            periodEnd:
              result.invoice.lines.data.find(
                (line) =>
                  line.pricing?.price_details?.price ===
                  operation.target.priceId,
              )?.period.end ?? operation.source.periodEnd,
          },
        }
      : {}),
  });
  const usage =
    result.kind === "paid"
      ? await settleChangeOffer(next, result.invoice, at(context))
      : undefined;
  const completed = await persist(next, operation, usage);
  await reconcileSubscription(
    context.stripe,
    operation.guildId,
    operation.source.subscriptionId,
  );
  return completed;
}
async function finishCancellation(
  context: Context,
  operation: Extract<BillingChangeOperation, { state: "canceling" }>,
) {
  await verifyPayer(context, operation);
  if (operation.timing === "renewal" && operation.consent) {
    const settled = await settleScheduled(context, operation);
    if (settled.state === "succeeded") return settled;
    if (
      !(await cancelChangeSchedule(
        context.stripe,
        operation,
        operation.scheduleId,
      ))
    )
      return operation;
  }
  let latest: BillingChangeOperation = operation;
  const recovery = await compensateChangeFunding({
    stripe: context.stripe,
    operation,
    onProgress: async (receipt) => {
      if (latest.state !== "canceling") throw changeUnavailable();
      latest = await persist(
        { ...latest, revision: randomUUID(), recovery: receipt },
        latest,
      );
    },
  });
  const next = billingChangeOperationSchema.parse({
    ...billingChangeBase(latest),
    revision: randomUUID(),
    state: "canceled",
    completedAt: at(context),
    recovery,
  });
  const usage = await releaseChangeOffer(
    next,
    operation.draftInvoiceId ?? operation.scheduleId ?? operation.operationId,
    at(context),
  );
  const completed = await persist(next, latest, usage);
  await reconcileSubscription(
    context.stripe,
    operation.guildId,
    operation.source.subscriptionId,
  );
  return completed;
}
export async function reconcileBillingChangeForWebhook(
  stripe: StripeClient,
  guildId: string,
) {
  const control = await repo().getControl(guildId);
  if (!control) return;
  const operation = await repo().getOperation(guildId, control.operationId);
  if (!operation) throw changeUnavailable();
  await resume({ stripe, guildId, payerId: operation.payerId }, operation);
}
