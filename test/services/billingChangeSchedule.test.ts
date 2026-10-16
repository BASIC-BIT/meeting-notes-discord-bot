/** @jest-environment node */
import {
  buildChangeSchedulePhases,
  cancelChangeSchedule,
  scheduleBillingChange,
  readScheduledChangeSettlement,
} from "../../src/services/billingChangeSchedule";
import {
  sourceSubscription,
  remainingDiscount,
} from "../fixtures/renewalStripe";
import { changeOperation } from "../fixtures/billingChange";
import { billingChangeBase } from "../../src/types/billingChange";
const operation = {
  ...billingChangeBase(changeOperation),
  timing: "renewal" as const,
  state: "accepted" as const,
  funding: null,
  consent: { at: 1700000001, quoteRevision: "reviewed" },
  target: {
    ...changeOperation.target,
    selection: {
      tier: "basic" as const,
      interval: "month" as const,
      expectedOffer: "none" as const,
    },
  },
};
it("keeps the paid phase and original discount identity until renewal", () => {
  const phases = buildChangeSchedulePhases(
    { ...sourceSubscription, discounts: [remainingDiscount] },
    operation,
  );
  expect(phases[0]).toMatchObject({
    start_date: operation.source.periodStart,
    end_date: operation.source.periodEnd,
    items: [{ price: operation.source.priceId, quantity: 1 }],
    discounts: [{ discount: remainingDiscount.id }],
    proration_behavior: "none",
  });
  expect(phases[1]).toMatchObject({
    start_date: operation.source.periodEnd,
    items: [{ price: operation.target.priceId, quantity: 1 }],
    discounts: "",
    proration_behavior: "none",
  });
});
it("reserves the unused monthly offer for three months without restarting the current coupon", () => {
  const terms = {
    priceId: "price_basic_month",
    couponId: "co_new_month",
    currency: "usd" as const,
    interval: "month" as const,
    regularUnitAmount: 1000 as const,
    discountedUnitAmount: 600 as const,
    durationMonths: 3 as const,
  };
  const next = {
    ...operation,
    target: {
      ...operation.target,
      offer: {
        id: "basic_intro_v1" as const,
        terms,
        authority: {
          guildId: operation.guildId,
          mode: "test" as const,
          offerId: "basic_intro_v1" as const,
          accountId: "acct-owned",
          coverageRevision: "coverage",
          boundaryRevision: "boundary",
          writerImageDigest: "sha256:" + "a".repeat(64),
        },
      },
    },
  };
  const phases = buildChangeSchedulePhases(sourceSubscription, next);
  expect(phases[1]).toMatchObject({
    discounts: [{ coupon: "co_new_month" }],
    duration: { interval: "month", interval_count: 3 },
  });
  expect(phases[0].discounts).toBe("");
});

import { stripeTransport } from "../fixtures/stripeTransport";
import {
  changeServiceFingerprint,
  changeSourceFingerprint,
} from "../../src/services/billingChangeProvider";
it("does not return an offer reservation when a released schedule has already changed the plan", async () => {
  const scheduled = {
    ...operation,
    state: "scheduled" as const,
    scheduleId: "sub_sched_owned",
  };
  const native = {
    ...sourceSubscription,
    id: operation.source.subscriptionId,
    customer: operation.source.customerId,
    metadata: { guild_id: operation.guildId },
    items: {
      ...sourceSubscription.items,
      data: [
        {
          ...sourceSubscription.items.data[0],
          id: operation.source.itemId,
          price: {
            ...sourceSubscription.items.data[0].price,
            id: operation.target.priceId ?? "",
          },
        },
      ],
    },
  };
  const schedule = {
    id: "sub_sched_owned",
    status: "active",
    livemode: false,
    customer: operation.source.customerId,
    subscription: operation.source.subscriptionId,
    metadata: { chronote_change_operation: operation.operationId },
  };
  const f = stripeTransport(({ path, method }) => {
    if (path.endsWith("/release") && method === "POST")
      return {
        ...schedule,
        status: "released",
        released_subscription: native.id,
      };
    if (path === "/v1/subscription_schedules/sub_sched_owned") return schedule;
    if (path === `/v1/subscriptions/${native.id}`) return native;
    throw new Error(`Unexpected ${method} ${path}`);
  });
  expect(
    await cancelChangeSchedule(f.stripe, scheduled, scheduled.scheduleId),
  ).toBe(false);
});
it("validates schedule ownership before clearing an existing cancellation", async () => {
  const native = {
    ...sourceSubscription,
    schedule: "sub_sched_foreign",
    cancel_at: operation.source.periodEnd,
    items: {
      ...sourceSubscription.items,
      data: [
        {
          ...sourceSubscription.items.data[0],
          id: operation.source.itemId,
          price: {
            ...sourceSubscription.items.data[0].price,
            id: operation.source.priceId,
          },
          current_period_start: operation.source.periodStart,
          current_period_end: operation.source.periodEnd,
        },
      ],
    },
    id: operation.source.subscriptionId,
    customer: operation.source.customerId,
    metadata: { guild_id: operation.guildId },
  };
  const selected = {
    ...operation,
    createdAt: Math.floor(Date.now() / 1000),
    source: {
      ...operation.source,
      invariantFingerprint: changeServiceFingerprint(native),
    },
  };
  const f = stripeTransport(({ path }) => {
    if (path === `/v1/subscriptions/${native.id}`) return native;
    if (path === "/v1/subscription_schedules/sub_sched_foreign")
      return {
        id: "sub_sched_foreign",
        livemode: false,
        subscription: native.id,
        metadata: { chronote_change_operation: "another-operation" },
      };
    throw new Error(`Unexpected request ${path}`);
  });
  await expect(scheduleBillingChange(f.stripe, selected)).rejects.toThrow();
  expect(
    f.requests.filter((request) => request.method === "POST"),
  ).toHaveLength(0);
});

it("creates from a subscription without unsupported metadata, then marks the owned schedule", async () => {
  const native = {
    ...sourceSubscription,
    id: operation.source.subscriptionId,
    customer: operation.source.customerId,
    metadata: { guild_id: operation.guildId },
    schedule: null,
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      ...sourceSubscription.items,
      data: [
        {
          ...sourceSubscription.items.data[0],
          id: operation.source.itemId,
          price: {
            ...sourceSubscription.items.data[0].price,
            id: operation.source.priceId,
          },
          current_period_start: operation.source.periodStart,
          current_period_end: operation.source.periodEnd,
        },
      ],
    },
  };
  const selected = {
    ...operation,
    createdAt: Math.floor(Date.now() / 1000),
    source: {
      ...operation.source,
      fingerprint: changeSourceFingerprint(native),
      invariantFingerprint: changeServiceFingerprint(native),
    },
  };
  const schedule = {
    id: "sub_sched_new",
    customer: operation.source.customerId,
    livemode: false,
    subscription: native.id,
    metadata: {},
  };
  const f = stripeTransport(({ path, method, fields }) => {
    if (path === `/v1/subscriptions/${native.id}`) return native;
    if (path === "/v1/subscription_schedules" && method === "POST") {
      expect(fields.has("metadata[chronote_change_operation]")).toBe(false);
      return schedule;
    }
    if (
      path === "/v1/subscription_schedules/sub_sched_new" &&
      method === "POST"
    )
      return {
        ...schedule,
        metadata: { chronote_change_operation: operation.operationId },
        phases: [
          {},
          {
            start_date: operation.source.periodEnd,
            items: [{ price: operation.target.priceId }],
          },
        ],
      };
    throw new Error(`Unexpected ${method} ${path}`);
  });
  expect(await scheduleBillingChange(f.stripe, selected)).toBe(schedule.id);
});

it("settles the actual target item when Stripe replaces the old item at renewal", async () => {
  const scheduled = {
    ...operation,
    state: "scheduled" as const,
    scheduleId: "sub_sched_owned",
  };
  const item = {
    ...sourceSubscription.items.data[0],
    id: "si_new_target",
    price: {
      ...sourceSubscription.items.data[0].price,
      id: operation.target.priceId ?? "",
    },
    current_period_start: operation.source.periodEnd,
    current_period_end: operation.source.periodEnd + 30 * 86400,
  };
  const native = {
    ...sourceSubscription,
    id: operation.source.subscriptionId,
    customer: operation.source.customerId,
    metadata: {
      guild_id: operation.guildId,
      chronote_change_operation: operation.operationId,
    },
    items: { ...sourceSubscription.items, data: [item] },
    latest_invoice: "in_scheduled",
  };
  const original = (await import("../fixtures/renewalStripe")).fundedInvoice;
  const invoice = {
    ...original,
    id: "in_scheduled",
    customer: operation.source.customerId,
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: native.id,
        metadata: {
          guild_id: operation.guildId,
          chronote_change_operation: operation.operationId,
        },
      },
    },
    lines: {
      ...original.lines,
      data: [
        {
          ...original.lines.data[0],
          amount: operation.target.unitAmount,
          quantity: 1,
          period: {
            start: operation.source.periodEnd,
            end: item.current_period_end,
          },
          pricing: { price_details: { price: operation.target.priceId } },
          parent: {
            subscription_item_details: {
              subscription: native.id,
              subscription_item: item.id,
            },
          },
        },
      ],
    },
  };
  const schedule = {
    id: "sub_sched_owned",
    status: "active",
    livemode: false,
    customer: operation.source.customerId,
    subscription: native.id,
    metadata: { chronote_change_operation: operation.operationId },
  };
  const f = stripeTransport(({ path }) => {
    if (path === `/v1/subscriptions/${native.id}`) return native;
    if (path === "/v1/invoices/in_scheduled") return invoice;
    if (path.endsWith("/release"))
      return {
        ...schedule,
        status: "released",
        released_subscription: native.id,
      };
    if (path === "/v1/subscription_schedules/sub_sched_owned") return schedule;
    throw new Error(`Unexpected ${path}`);
  });
  expect(
    await readScheduledChangeSettlement(f.stripe, scheduled),
  ).toMatchObject({ kind: "paid", invoice: { id: "in_scheduled" } });
});
