/** @jest-environment node */
import { acceptPurchaseSubscription } from "../../src/services/purchaseReconciliation";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import { getPurchaseRepository } from "../../src/repositories/purchaseAttemptRepository";
import { getOfferUsageRepository } from "../../src/repositories/offerUsageRepository";
import type { PurchaseAttempt } from "../../src/types/purchase";
import type { StripeClient, StripeSubscription } from "../../src/types/stripe";

const guildId = "111111111111111111";
const createdAt = Date.parse("2026-10-14T12:00:00Z");
async function fixture(annual = false) {
  resetMockStore();
  const offerId = annual ? "basic_annual_intro_v1" : "basic_intro_v1";
  const unitAmount = annual ? 10000 : 1000;
  const paid = annual ? 6000 : 600;
  const operation: PurchaseAttempt = {
    guildId,
    attemptId: "op",
    revision: "op-r1",
    payerId: "payer",
    customerId: "cus",
    mode: "test",
    fingerprint: "terms",
    createdAt,
    state: "open",
    sessionId: "cs",
    checkout: {
      metadata: { intro_offer_id: offerId, intro_offer_coupon_id: "coupon" },
      line_items: [{ price: "price", quantity: 1 }],
      discounts: [{ coupon: "coupon" }],
    },
  };
  const reserved = {
    guildId,
    mode: "test",
    offerId,
    revision: "offer-r1",
    state: "reserved",
    operationId: "op",
    reservedAt: createdAt,
    terms: {
      priceId: "price",
      couponId: "coupon",
      currency: "usd",
      interval: annual ? "year" : "month",
      regularUnitAmount: unitAmount,
      discountedUnitAmount: paid,
      durationMonths: annual ? 12 : 3,
    },
  };
  getMockStore().subscriptions.set(guildId, {
    guildId,
    status: "active",
    tier: "basic",
    subscriptionType: "stripe",
    startDate: "now",
    stripeCustomerId: "cus",
    stripeSubscriptionId: "sub",
    stripeSyncRevision: "sub-r1",
  });
  await getPurchaseRepository().compareAndWrite(
    operation,
    undefined,
    getMockStore().subscriptions.get(guildId),
    undefined,
    { next: reserved, expected: undefined },
  );
  const discount = { id: "di", source: { type: "coupon", coupon: "coupon" } };
  const invoice = {
    id: "in",
    customer: "cus",
    status: "paid",
    livemode: false,
    currency: "usd",
    billing_reason: "subscription_create",
    parent: { subscription_details: { subscription: "sub" } },
    amount_paid: paid,
    amount_remaining: 0,
    subtotal: unitAmount,
    total_excluding_tax: paid,
    status_transitions: { paid_at: createdAt / 1000 + 1 },
    discounts: [discount],
    total_discount_amounts: [{ amount: unitAmount - paid, discount: "di" }],
    lines: {
      has_more: false,
      data: [
        {
          id: "il",
          invoice: "in",
          currency: "usd",
          livemode: false,
          quantity: 1,
          amount: unitAmount,
          subtotal: unitAmount,
          pricing: { price_details: { price: "price" } },
          parent: {
            subscription_item_details: {
              subscription: "sub",
              subscription_item: "si",
              proration: false,
            },
          },
          period: {
            start: createdAt / 1000,
            end: createdAt / 1000 + (annual ? 365 : 31) * 86400,
          },
          discount_amounts: [{ amount: unitAmount - paid, discount: "di" }],
        },
      ],
    },
  };
  const subscription = {
    id: "sub",
    status: "active",
    customer: "cus",
    livemode: false,
    metadata: {
      guild_id: guildId,
      discord_id: "payer",
      purchase_attempt_id: "op",
      intro_offer_id: offerId,
      intro_offer_coupon_id: "coupon",
    },
    latest_invoice: "in",
    discounts: [],
    items: {
      data: [
        {
          id: "si",
          quantity: 1,
          price: {
            id: "price",
            currency: "usd",
            unit_amount: unitAmount,
            recurring: {
              interval: annual ? "year" : "month",
              interval_count: 1,
            },
          },
          current_period_start: createdAt / 1000,
          current_period_end: invoice.lines.data[0].period.end,
        },
      ],
    },
  };
  const stripe = {
    invoices: { retrieve: jest.fn(async () => invoice) },
    checkout: {
      sessions: {
        retrieve: jest.fn(async () => ({
          id: "cs",
          status: "complete",
          customer: "cus",
          livemode: false,
          subscription: "sub",
          invoice: "in",
          metadata: { guild_id: guildId, purchase_attempt_id: "op" },
        })),
      },
    },
  };
  return {
    offerId,
    invoice,
    subscription,
    stripe,
    native: subscription as unknown as StripeSubscription,
    client: stripe as unknown as StripeClient,
    reserved,
  };
}
beforeEach(() => {
  jest.useFakeTimers({ now: createdAt + 5000 });
});
afterEach(() => jest.useRealTimers());

test.each([false, true])(
  "a settled first invoice finalizes only the %s cadence offer once",
  async (annual) => {
    const f = await fixture(annual);
    await acceptPurchaseSubscription(guildId, f.native, f.client);
    const used = await getOfferUsageRepository().get(
      guildId,
      f.offerId,
      "test",
    );
    expect(used).toMatchObject({
      state: "used",
      operationId: "op",
      settlement: {
        invoiceId: "in",
        customerId: "cus",
        subscriptionId: "sub",
        subscriptionItemId: "si",
        amountPaid: annual ? 6000 : 600,
        amountRemaining: 0,
      },
    });
    expect(getMockStore().purchaseAttempts.get(guildId)?.state).toBe(
      "completed",
    );
    f.subscription.latest_invoice = "later-renewal";
    await acceptPurchaseSubscription(guildId, f.native, f.client);
    expect(
      await getOfferUsageRepository().get(guildId, f.offerId, "test"),
    ).toEqual(used);
    expect(
      await getOfferUsageRepository().get(
        guildId,
        annual ? "basic_intro_v1" : "basic_annual_intro_v1",
        "test",
      ),
    ).toBeUndefined();
  },
);

test("a settled credit-covered zero-cash invoice consumes the offer", async () => {
  const f = await fixture();
  f.invoice.amount_paid = 0;
  await acceptPurchaseSubscription(guildId, f.native, f.client);
  expect(
    await getOfferUsageRepository().get(guildId, f.offerId, "test"),
  ).toMatchObject({ state: "used", settlement: { amountPaid: 0 } });
});

test("failed payment leaves use reserved until the same invoice settles", async () => {
  const f = await fixture();
  f.invoice.status = "open";
  f.invoice.amount_paid = 0;
  f.invoice.amount_remaining = 600;
  await acceptPurchaseSubscription(guildId, f.native, f.client);
  expect(
    await getOfferUsageRepository().get(guildId, f.offerId, "test"),
  ).toEqual(f.reserved);
  expect(getMockStore().purchaseAttempts.get(guildId)?.initialInvoiceId).toBe(
    "in",
  );
  f.invoice.status = "paid";
  f.invoice.amount_paid = 600;
  f.invoice.amount_remaining = 0;
  await acceptPurchaseSubscription(guildId, f.native, f.client);
  expect(
    await getOfferUsageRepository().get(guildId, f.offerId, "test"),
  ).toMatchObject({ state: "used" });
});

test.each([
  "customer",
  "subscription",
  "price",
  "coupon",
  "discount",
  "mode",
  "quantity",
  "renewal",
  "proration",
])(
  "rejects mismatched %s invoice evidence without consuming the reserved offer",
  async (change) => {
    const f = await fixture();
    if (change === "customer") f.invoice.customer = "wrong";
    if (change === "subscription")
      f.invoice.parent.subscription_details.subscription = "wrong";
    if (change === "price")
      f.invoice.lines.data[0].pricing.price_details.price = "wrong";
    if (change === "coupon") f.invoice.discounts[0].source.coupon = "wrong";
    if (change === "discount") f.invoice.total_discount_amounts[0].amount = 0;
    if (change === "mode") f.invoice.livemode = true;
    if (change === "quantity") f.invoice.lines.data[0].quantity = 2;
    if (change === "renewal") f.invoice.billing_reason = "subscription_cycle";
    if (change === "proration")
      f.invoice.lines.data[0].parent.subscription_item_details.proration = true;
    await expect(
      acceptPurchaseSubscription(guildId, f.native, f.client),
    ).rejects.toThrow("Offer settlement");
    expect(
      await getOfferUsageRepository().get(guildId, f.offerId, "test"),
    ).toEqual(f.reserved);
  },
);

test.each([false, true])(
  "native inclusive tax first-invoice fields consume the %s offer",
  async (annual) => {
    const f = await fixture(annual);
    f.invoice.total_excluding_tax = annual ? 5607 : 561;
    f.invoice.lines.data[0].subtotal = annual ? 9607 : 961;
    await acceptPurchaseSubscription(guildId, f.native, f.client);
    expect(
      await getOfferUsageRepository().get(guildId, f.offerId, "test"),
    ).toMatchObject({
      state: "used",
      settlement: { amountPaid: annual ? 6000 : 600 },
    });
  },
);
test("a delayed first-payment event consumes the original offer after a later plan change", async () => {
  const f = await fixture();
  f.subscription.latest_invoice = "in-later";
  f.subscription.items.data[0].price.id = "price-pro";
  f.subscription.items.data[0].price.unit_amount = 2400;
  f.subscription.items.data[0].current_period_start += 31 * 86400;
  f.subscription.items.data[0].current_period_end += 31 * 86400;
  await acceptPurchaseSubscription(guildId, f.native, f.client, {
    invoiceId: "in",
  });
  expect(
    await getOfferUsageRepository().get(guildId, f.offerId, "test"),
  ).toMatchObject({
    state: "used",
    settlement: { invoiceId: "in", priceId: "price" },
  });
  expect(getMockStore().purchaseAttempts.get(guildId)?.initialInvoiceId).toBe(
    "in",
  );
});

test("a later renewal recovers the original invoice from its associated completed Checkout", async () => {
  const f = await fixture();
  f.subscription.latest_invoice = "in-renewal";
  f.subscription.items.data[0].current_period_start += 31 * 86400;
  f.subscription.items.data[0].current_period_end += 31 * 86400;
  const renewal = {
    ...f.invoice,
    id: "in-renewal",
    billing_reason: "subscription_cycle",
  };
  f.stripe.invoices.retrieve.mockImplementation(async (id: string) =>
    id === "in-renewal" ? renewal : f.invoice,
  );
  Object.assign(f.stripe, {
    checkout: {
      sessions: {
        retrieve: jest.fn(async () => ({
          id: "cs",
          status: "complete",
          customer: "cus",
          livemode: false,
          subscription: "sub",
          invoice: "in",
          metadata: { guild_id: guildId, purchase_attempt_id: "op" },
        })),
      },
    },
  });
  await acceptPurchaseSubscription(guildId, f.native, f.client, {
    invoiceId: "in-renewal",
  });
  expect(
    await getOfferUsageRepository().get(guildId, f.offerId, "test"),
  ).toMatchObject({
    state: "used",
    settlement: { invoiceId: "in" },
  });
  expect(getMockStore().purchaseAttempts.get(guildId)?.initialInvoiceId).toBe(
    "in",
  );
});

test("a known introductory purchase with missing reservation requires reconciliation", async () => {
  const f = await fixture();
  getMockStore().offerUsages.clear();
  await expect(
    acceptPurchaseSubscription(guildId, f.native, f.client),
  ).rejects.toThrow("Offer settlement");
  expect(getMockStore().purchaseAttempts.get(guildId)?.state).toBe("open");
});

test("the original invoice binding cannot be changed by a retry of the same purchase", async () => {
  const f = await fixture();
  await acceptPurchaseSubscription(guildId, f.native, f.client);
  const repo = getPurchaseRepository();
  const current = (await repo.get(guildId))!;
  await expect(
    repo.compareAndWrite(
      { ...current, revision: "tampered", initialInvoiceId: "in-other" },
      current,
      getMockStore().subscriptions.get(guildId),
    ),
  ).rejects.toThrow("Initial invoice binding");
  expect((await repo.get(guildId))?.initialInvoiceId).toBe("in");
});
