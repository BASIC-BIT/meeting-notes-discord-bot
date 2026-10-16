import { randomUUID } from "node:crypto";
import type {
  StripeClient,
  StripeSubscription,
  StripeInvoice,
} from "../types/stripe";
import type { GuildSubscription } from "../types/db";
import {
  renewalRecoverySchema,
  renewalGraceDeadline,
  isRenewalRecoveryBlocking,
  type RenewalRecovery,
} from "../types/renewalRecovery";
import { getRenewalRecoveryRepository } from "../repositories/renewalRecoveryRepository";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import {
  assertRenewalOwner,
  readRenewalPaidBasis,
  findRenewalInvoice,
  verifyRenewalInvoice,
} from "./renewalRecoveryEvidence";
import { config } from "./configService";
import { stripeId, changeUnavailable } from "./billingChangeProvider";
import { clearGuildSubscriptionCache } from "./subscriptionCache";

type Context = { stripe: StripeClient; guildId: string; now: number };
export async function trackPaidRenewalPeriod(
  input: Context & { subscriptionId: string; invoiceId: string },
): Promise<void> {
  const saved = await getSubscriptionRepository().get(input.guildId);
  if (!saved || saved.stripeSubscriptionId !== input.subscriptionId) return;
  const subscription = await input.stripe.subscriptions.retrieve(
    input.subscriptionId,
  );
  const customerId = stripeId(subscription.customer);
  if (!customerId) throw changeUnavailable();
  const mode = subscription.livemode ? "live" : "test";
  assertRenewalOwner(subscription, {
    guildId: input.guildId,
    subscriptionId: input.subscriptionId,
    customerId: saved.stripeCustomerId ?? customerId,
    mode: config.subscription.stripeMode === "live" ? "live" : "test",
  });
  const paid = await readRenewalPaidBasis(
    input.stripe,
    subscription,
    input.guildId,
    input.invoiceId,
  );
  const current = await getRenewalRecoveryRepository().getCurrent(
    input.guildId,
  );
  if (
    current &&
    current.subscriptionId === subscription.id &&
    current.paid.periodEnd >= paid.periodEnd
  )
    return;
  const record = renewalRecoverySchema.parse({
    guildId: input.guildId,
    subscriptionId: subscription.id,
    customerId,
    payerId: subscription.metadata.discord_id,
    mode,
    paid,
    revision: randomUUID(),
    scheduledOperationId: null,
    enforcementAccepted: false,
    state: "watching",
    nextCheckAt: paid.periodEnd,
  });
  if (
    !(await getRenewalRecoveryRepository().register({
      record,
      expectedSubscription: saved,
    }))
  )
    throw changeUnavailable();
}
async function saveRecovery(
  next: RenewalRecovery,
  previous: RenewalRecovery,
  pointer: GuildSubscription,
): Promise<RenewalRecovery> {
  if (
    !(await getRenewalRecoveryRepository().compareAndWrite({
      next,
      expectedRevision: previous.revision,
      expectedSubscription: pointer,
      blocking: isRenewalRecoveryBlocking(next),
    }))
  )
    throw changeUnavailable();
  clearGuildSubscriptionCache(next.guildId);
  return next;
}
export async function refreshRenewalRecovery(
  input: Context,
): Promise<RenewalRecovery | undefined> {
  const record = await getRenewalRecoveryRepository().getCurrent(input.guildId);
  if (
    !record ||
    record.state === "paid" ||
    record.state === "canceled" ||
    record.state === "ended"
  )
    return record;
  const pointer = await getSubscriptionRepository().get(input.guildId);
  if (
    !pointer ||
    pointer.stripeSubscriptionId !== record.subscriptionId ||
    (pointer.stripeCustomerId && pointer.stripeCustomerId !== record.customerId)
  )
    return record;
  if (record.state === "watching" && input.now < record.paid.periodEnd)
    return record;
  const subscription = await input.stripe.subscriptions.retrieve(
    record.subscriptionId,
  );
  assertRenewalOwner(subscription, record);
  const invoice = await findRenewalInvoice(input.stripe, record, subscription);
  if (!invoice) {
    if (subscription.status === "canceled" && record.state === "watching") {
      const { nextCheckAt, ...base } = record;
      void nextCheckAt;
      return saveRecovery(
        renewalRecoverySchema.parse({
          ...base,
          state: "ended",
          revision: randomUUID(),
        }),
        record,
        pointer,
      );
    }
    return postpone(input, record, pointer);
  }
  return observeRenewalInvoice(input, record, pointer, subscription, invoice);
}
async function observeRenewalInvoice(
  input: Context,
  record: Extract<
    RenewalRecovery,
    { state: "watching" | "grace" | "canceling" }
  >,
  pointer: GuildSubscription,
  subscription: StripeSubscription,
  invoice: StripeInvoice,
): Promise<RenewalRecovery> {
  const evidence = await verifyRenewalInvoice(invoice, record, subscription);
  const finalizedAt = invoice.status_transitions.finalized_at;
  if (!finalizedAt || invoice.status === "draft")
    return postpone(input, record, pointer);
  const bound = {
    invoice: {
      id: invoice.id,
      lineId: evidence.line.id,
      finalizedAt,
      periodStart: evidence.line.period.start,
      periodEnd: evidence.line.period.end,
    },
    endsAt: renewalGraceDeadline(finalizedAt),
  };
  if (invoice.status === "paid" && invoice.amount_remaining === 0) {
    if (record.state === "canceling") return record;
    const { nextCheckAt, ...base } = record;
    void nextCheckAt;
    return saveRecovery(
      renewalRecoverySchema.parse({
        ...base,
        ...bound,
        scheduledOperationId: evidence.scheduledOperationId,
        state: "paid",
        projection: { state: "pending", nextCheckAt: input.now },
        revision: randomUUID(),
      }),
      record,
      pointer,
    );
  }
  if (record.state !== "watching") return record;
  if (!invoice.attempted || !config.stripe.renewalGraceEnabled)
    return postpone(input, record, pointer);
  return saveRecovery(
    renewalRecoverySchema.parse({
      ...record,
      ...bound,
      scheduledOperationId: evidence.scheduledOperationId,
      state: "grace",
      enforcementAccepted: true,
      revision: randomUUID(),
      nextCheckAt: bound.endsAt,
    }),
    record,
    pointer,
  );
}
function postpone(
  input: Context,
  record: RenewalRecovery,
  pointer: GuildSubscription,
): Promise<RenewalRecovery> {
  if (!("nextCheckAt" in record)) return Promise.resolve(record);
  return saveRecovery(
    { ...record, revision: randomUUID(), nextCheckAt: input.now + 60 },
    record,
    pointer,
  );
}

export async function completeRenewalPaidProjection(
  guildId: string,
  subscription: StripeSubscription,
  saved: GuildSubscription,
): Promise<void> {
  const record = await getRenewalRecoveryRepository().getCurrent(guildId);
  if (
    !record ||
    record.state !== "paid" ||
    record.projection.state === "complete"
  )
    return;
  assertRenewalOwner(subscription, record);
  const item = subscription.items.data[0];
  if (
    subscription.status !== "active" ||
    saved.status !== "active" ||
    saved.stripeSubscriptionId !== record.subscriptionId ||
    item.current_period_start !== record.invoice.periodStart ||
    item.current_period_end !== record.invoice.periodEnd ||
    saved.priceId !== item.price.id
  )
    throw changeUnavailable();
  await saveRecovery(
    { ...record, revision: randomUUID(), projection: { state: "complete" } },
    record,
    saved,
  );
}
