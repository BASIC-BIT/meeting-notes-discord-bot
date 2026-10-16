/** @jest-environment node */
import { reconcileSubscription } from "../../src/services/subscriptionReconciliation";
import { getRenewalRecoveryView } from "../../src/services/renewalRecoveryView";
import { offerUsageKey, offerUsageSchema } from "../../src/types/offerUsage";
import { renewalRecoveryKey } from "../../src/types/renewalRecovery";
import { classifyChangeHistory } from "../../src/services/billingChangeHistory";
import { cancelBillingChange } from "../../src/services/billingChangeService";
import * as renewalProvider from "../../src/services/renewalRecoveryProvider";
import * as renewalPayer from "../../src/services/billingPayerService";
import { config } from "../../src/services/configService";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import { getRenewalRecoveryRepository } from "../../src/repositories/renewalRecoveryRepository";
import {
  trackPaidRenewalPeriod,
  cancelRenewalRecovery,
  reconcileRenewalRecovery,
  refreshRenewalRecovery,
  completeRenewalPaidProjection,
} from "../../src/services/renewalRecoveryService";
import { changeOperation } from "../fixtures/billingChange";
import {
  sourceSubscription,
  fundedInvoice,
  paidEndsAt,
} from "../fixtures/renewalStripe";
import { renewalSubscription } from "../fixtures/renewal";
import { stripeTransport } from "../fixtures/stripeTransport";

const original = {
  mock: config.mock.enabled,
  enabled: config.stripe.renewalGraceEnabled,
  mode: config.subscription.stripeMode,
};
beforeEach(() => {
  config.mock.enabled = true;
  config.subscription.stripeMode = "test";
  config.stripe.renewalGraceEnabled = true;
  resetMockStore();
  getMockStore().subscriptions.set(
    renewalSubscription.guildId,
    structuredClone(renewalSubscription),
  );
});
afterEach(() => {
  config.mock.enabled = original.mock;
  config.stripe.renewalGraceEnabled = original.enabled;
  config.subscription.stripeMode = original.mode;
});
function fixture() {
  const subscription = {
    ...sourceSubscription,
    metadata: { ...sourceSubscription.metadata },
    items: {
      ...sourceSubscription.items,
      data: sourceSubscription.items.data.map((item) => ({
        ...item,
        price: {
          ...item.price,
          recurring: item.price.recurring ? { ...item.price.recurring } : null,
        },
      })),
    },
  };
  subscription.cancel_at = null;
  subscription.cancel_at_period_end = false;
  const renewal = {
    ...fundedInvoice,
    metadata: { ...fundedInvoice.metadata },
    status_transitions: { ...fundedInvoice.status_transitions },
    lines: {
      ...fundedInvoice.lines,
      data: fundedInvoice.lines.data.map((line) => ({
        ...line,
        period: { ...line.period },
        pricing: line.pricing
          ? {
              ...line.pricing,
              price_details: line.pricing.price_details
                ? { ...line.pricing.price_details }
                : null,
            }
          : null,
      })),
    },
  };
  renewal.id = "in_renewal";
  renewal.billing_reason = "subscription_cycle";
  renewal.status = "open";
  renewal.amount_paid = 0;
  renewal.amount_remaining = 1000;
  renewal.status_transitions.finalized_at = paidEndsAt + 3600;
  renewal.created = paidEndsAt;
  renewal.lines.data[0].id = "il_renewal";
  renewal.lines.data[0].period = {
    start: paidEndsAt,
    end: paidEndsAt + 2592000,
  };
  const invoices = new Map([
    [fundedInvoice.id, { ...fundedInvoice }],
    [renewal.id, renewal],
  ]);
  const transport = stripeTransport((request) => {
    if (request.path === `/v1/subscriptions/${subscription.id}`)
      return subscription;
    if (request.path === "/v1/customers/cus_renewal")
      return {
        id: "cus_renewal",
        livemode: false,
        metadata: { discord_id: subscription.metadata.discord_id },
      };
    if (request.path.startsWith("/v1/prices/"))
      return subscription.items.data[0].price;
    if (request.path.startsWith("/v1/invoices/"))
      return invoices.get(request.path.split("/").at(-1) ?? "");
    if (request.path === "/v1/invoices")
      return {
        object: "list",
        data: [renewal],
        has_more: false,
        url: request.path,
      };
    throw new Error(`Unexpected request ${request.path}`);
  });
  const track = () =>
    trackPaidRenewalPeriod({
      stripe: transport.stripe,
      guildId: renewalSubscription.guildId,
      subscriptionId: subscription.id,
      invoiceId: fundedInvoice.id,
      now: paidEndsAt - 1,
    });
  const refresh = (now = paidEndsAt + 4000) =>
    refreshRenewalRecovery({
      stripe: transport.stripe,
      guildId: renewalSubscription.guildId,
      now,
    });
  const fail = () => {
    subscription.status = "past_due";
    subscription.latest_invoice = renewal.id;
    subscription.items.data[0].current_period_start =
      renewal.lines.data[0].period.start;
    subscription.items.data[0].current_period_end =
      renewal.lines.data[0].period.end;
  };
  return {
    ...transport,
    subscription,
    renewal,
    invoices,
    track,
    refresh,
    fail,
  };
}
test("discovers failed renewal from the saved paid boundary when webhooks are dropped", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const record = await f.refresh();
  expect(record).toMatchObject({
    state: "grace",
    endsAt: paidEndsAt + 3600 + 172800,
    enforcementAccepted: true,
    paid: { tier: "basic" },
  });
  const later = await f.refresh(paidEndsAt + 9000);
  expect(later).toMatchObject({ endsAt: paidEndsAt + 3600 + 172800 });
});
test.each(["basic", "pro"] as const)(
  "tracks %s monthly and annual paid periods",
  async (tier) => {
    for (const interval of ["month", "year"] as const) {
      resetMockStore();
      getMockStore().subscriptions.set(
        renewalSubscription.guildId,
        structuredClone(renewalSubscription),
      );
      const f = fixture();
      const price = f.subscription.items.data[0].price;
      price.lookup_key = `chronote_${tier}_${interval === "month" ? "monthly" : "annual"}`;
      if (!price.recurring) throw new Error("Missing recurring fixture");
      price.recurring.interval = interval;
      await f.track();
      expect(
        (
          await getRenewalRecoveryRepository().getCurrent(
            renewalSubscription.guildId,
          )
        )?.paid,
      ).toMatchObject({ tier, interval });
    }
  },
);
test("keeps draft, unattempted and unknown invoice states out of failed-payment grace", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  f.renewal.status = "draft";
  f.renewal.attempted = false;
  f.renewal.status_transitions.finalized_at = null;
  expect(await f.refresh()).toMatchObject({
    state: "watching",
    enforcementAccepted: false,
  });
});
test("does not adopt a new grace or block billing while the flag is off", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  config.stripe.renewalGraceEnabled = false;
  expect(await f.refresh()).toMatchObject({
    state: "grace",
    enforcementAccepted: false,
  });
  expect(
    getMockStore().renewalRecoveryPointers.get(renewalSubscription.guildId)
      ?.blocking,
  ).toBe(false);
});
test.each(["customer", "mode", "credited", "first_purchase", "funding"])(
  "rejects unsafe renewal evidence: %s",
  async (mismatch) => {
    const f = fixture();
    await f.track();
    f.fail();
    if (mismatch === "customer") f.renewal.customer = "cus_other";
    if (mismatch === "mode") f.renewal.livemode = true;
    if (mismatch === "credited") f.renewal.pre_payment_credit_notes_amount = 10;
    if (mismatch === "first_purchase")
      f.renewal.billing_reason = "subscription_create";
    if (mismatch === "funding")
      f.renewal.metadata.chronote_invoice_role = "funding";
    await expect(f.refresh()).rejects.toThrow();
    expect(
      (
        await getRenewalRecoveryRepository().getCurrent(
          renewalSubscription.guildId,
        )
      )?.state,
    ).toBe("watching");
  },
);
test("accepts a paid period funded by customer credit without requiring paid cash", async () => {
  const f = fixture();
  const invoice = f.invoices.get(fundedInvoice.id);
  if (!invoice) throw new Error("Missing invoice");
  invoice.amount_paid = 0;
  invoice.amount_due = 0;
  invoice.starting_balance = -1000;
  await f.track();
  expect(
    (
      await getRenewalRecoveryRepository().getCurrent(
        renewalSubscription.guildId,
      )
    )?.paid.invoiceId,
  ).toBe(fundedInvoice.id);
});
test("refuses to reuse reversed paid service and ignores an old subscription after replacement", async () => {
  const f = fixture();
  const invoice = f.invoices.get(fundedInvoice.id);
  if (!invoice) throw new Error("Missing invoice");
  invoice.post_payment_credit_notes_amount = 1000;
  await expect(f.track()).rejects.toThrow();
  invoice.post_payment_credit_notes_amount = 0;
  await f.track();
  f.fail();
  getMockStore().subscriptions.set(renewalSubscription.guildId, {
    ...renewalSubscription,
    stripeSubscriptionId: "sub_new",
    stripeSyncRevision: "new",
  });
  expect((await f.refresh())?.state).toBe("watching");
  expect(
    f.requests.filter((request) => request.path === "/v1/invoices"),
  ).toHaveLength(0);
});

test("recognizes a scheduled downgrade but treats its old metadata as ordinary next cycle", async () => {
  const { f, operation } = await scheduledFixture();
  expect(await f.refresh()).toMatchObject({
    state: "grace",
    scheduledOperationId: operation.operationId,
    paid: { tier: "pro" },
  });
  f.renewal.status = "paid";
  f.renewal.amount_remaining = 0;
  expect(await f.refresh()).toMatchObject({
    state: "paid",
    projection: { state: "pending" },
  });
  const beforeProjection = getMockStore().renewalRecoveryPointers.get(
    renewalSubscription.guildId,
  );
  expect(beforeProjection?.blocking).toBe(true);
  expect(
    (
      await getRenewalRecoveryRepository().listDue({
        mode: "test",
        now: paidEndsAt + 4000,
        limit: 100,
      })
    ).keys,
  ).toContain(beforeProjection?.key);
  const saved = {
    ...renewalSubscription,
    status: "active",
    tier: "basic",
    priceId: "price_basic",
  };
  getMockStore().subscriptions.set(saved.guildId, saved);
  f.subscription.status = "active";
  await completeRenewalPaidProjection(saved.guildId, f.subscription, saved);
  expect(
    getMockStore().renewalRecoveryPointers.get(saved.guildId)?.blocking,
  ).toBe(false);
  expect(
    (
      await getRenewalRecoveryRepository().listDue({
        mode: "test",
        now: paidEndsAt + 4000,
        limit: 100,
      })
    ).keys,
  ).not.toContain(beforeProjection?.key);
  await trackPaidRenewalPeriod({
    stripe: f.stripe,
    guildId: renewalSubscription.guildId,
    subscriptionId: f.subscription.id,
    invoiceId: f.renewal.id,
    now: paidEndsAt + 4000,
  });
  const next = {
    ...f.renewal,
    id: "in_following",
    status: "open" as const,
    amount_remaining: 1000,
    created: f.renewal.lines.data[0].period.end,
    status_transitions: {
      ...f.renewal.status_transitions,
      finalized_at: f.renewal.lines.data[0].period.end,
    },
    lines: {
      ...f.renewal.lines,
      data: f.renewal.lines.data.map((line) => ({
        ...line,
        id: "il_following",
        period: { start: line.period.end, end: line.period.end + 2592000 },
      })),
    },
  };
  f.invoices.set(next.id, next);
  f.subscription.latest_invoice = next.id;
  f.subscription.items.data[0].current_period_start =
    next.lines.data[0].period.start;
  f.subscription.items.data[0].current_period_end =
    next.lines.data[0].period.end;
  expect(await f.refresh(next.created + 100)).toMatchObject({
    state: "grace",
    scheduledOperationId: null,
  });
});

test("accepts the provider's expanded price reference on a renewal service line", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const pricing = f.renewal.lines.data[0].pricing;
  if (!pricing?.price_details) throw new Error("Missing price fixture");
  pricing.price_details = {
    ...pricing.price_details,
    price: f.subscription.items.data[0].price,
  };
  expect(await f.refresh()).toMatchObject({ state: "grace" });
});

test("explicit cancellation keeps its grace deadline and releases billing only after saved Free access", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const grace = await f.refresh();
  if (!grace || grace.state !== "grace") throw new Error("Expected grace");
  const payer = jest
    .spyOn(renewalPayer, "assertStripePayer")
    .mockResolvedValue();
  const provider = jest
    .spyOn(renewalProvider, "cancelUnpaidRenewal")
    .mockImplementation(async (input) => {
      if (input.recovery.state !== "canceling")
        throw new Error("Expected cancellation");
      await input.onReceipt({
        ...input.recovery,
        revision: "native-canceled",
        receipts: {
          ...input.recovery.receipts,
          canceled: true,
          collectionRestored: true,
          collectionToRestore: [],
        },
      });
      f.subscription.status = "canceled";
      return "canceled";
    });
  try {
    await cancelRenewalRecovery({
      stripe: f.stripe,
      guildId: grace.guildId,
      payerId: grace.payerId,
      now: paidEndsAt + 4001,
    });
    expect(
      await getRenewalRecoveryRepository().getCurrent(grace.guildId),
    ).toMatchObject({ state: "canceled", endsAt: grace.endsAt });
    expect(
      getMockStore().renewalRecoveryPointers.get(grace.guildId)?.blocking,
    ).toBe(false);
    expect(getMockStore().subscriptions.get(grace.guildId)).toMatchObject({
      status: "canceled",
      tier: "free",
    });
  } finally {
    provider.mockRestore();
    payer.mockRestore();
  }
});
test("expiry starts cleanup automatically and retains control when the provider is unavailable", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const grace = await f.refresh();
  if (!grace || grace.state !== "grace") throw new Error("Expected grace");
  const provider = jest
    .spyOn(renewalProvider, "cancelUnpaidRenewal")
    .mockRejectedValue(new Error("Provider unavailable"));
  try {
    await expect(
      reconcileRenewalRecovery({
        stripe: f.stripe,
        guildId: grace.guildId,
        now: grace.endsAt,
      }),
    ).rejects.toThrow("Provider unavailable");
    expect(
      await getRenewalRecoveryRepository().getCurrent(grace.guildId),
    ).toMatchObject({
      state: "canceling",
      reason: "expired",
      endsAt: grace.endsAt,
    });
    expect(
      getMockStore().renewalRecoveryPointers.get(grace.guildId)?.blocking,
    ).toBe(true);
  } finally {
    provider.mockRestore();
  }
});
test("rejects another payer before any cancellation write", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const grace = await f.refresh();
  if (!grace) throw new Error("Expected grace");
  await expect(
    cancelRenewalRecovery({
      stripe: f.stripe,
      guildId: grace.guildId,
      payerId: "another-payer",
      now: paidEndsAt + 4001,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await getRenewalRecoveryRepository().getCurrent(grace.guildId))?.state,
  ).toBe("grace");
});
test("a paid renewal completes access reconciliation and queues its next paid period", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const grace = await f.refresh();
  if (!grace) throw new Error("Expected grace");
  f.renewal.status = "paid";
  f.renewal.amount_remaining = 0;
  f.subscription.status = "active";
  await reconcileRenewalRecovery({
    stripe: f.stripe,
    guildId: grace.guildId,
    now: paidEndsAt + 5000,
  });
  expect(
    await getRenewalRecoveryRepository().getCurrent(grace.guildId),
  ).toMatchObject({ state: "watching", paid: { invoiceId: f.renewal.id } });
  expect(
    getMockStore().renewalRecoveryPointers.get(grace.guildId)?.blocking,
  ).toBe(false);
});

async function scheduledFixture(withOffer = false) {
  const f = fixture();
  f.subscription.items.data[0].price.lookup_key = "chronote_pro_monthly";
  await f.track();
  f.fail();
  f.subscription.items.data[0].price.id = "price_basic";
  f.subscription.items.data[0].price.lookup_key = "chronote_basic_monthly";
  const pricing = f.renewal.lines.data[0].pricing;
  if (!pricing?.price_details) throw new Error("Missing price fixture");
  pricing.price_details = { ...pricing.price_details, price: "price_basic" };
  const operation = {
    ...changeOperation,
    payerId: f.subscription.metadata.discord_id,
    timing: "renewal" as const,
    state: "scheduled" as const,
    scheduleId: "sub_sched",
    consent: { at: paidEndsAt - 100, quoteRevision: changeOperation.revision },
    source: {
      ...changeOperation.source,
      customerId: "cus_renewal",
      periodEnd: paidEndsAt,
    },
    target: {
      ...changeOperation.target,
      priceId: "price_basic",
      selection: {
        tier: "basic" as const,
        interval: "month" as const,
        expectedOffer: "none" as const,
      },
    },
  };
  if (withOffer) {
    operation.target.offer = {
      id: "basic_intro_v1",
      authority: {
        guildId: operation.guildId,
        mode: "test",
        offerId: "basic_intro_v1",
        accountId: "acct_owned",
        coverageRevision: "coverage",
        boundaryRevision: "boundary",
        writerImageDigest: "sha256:" + "a".repeat(64),
      },
      terms: {
        interval: "month",
        currency: "usd",
        priceId: "price_basic",
        couponId: "co_monthly",
        regularUnitAmount: 1000,
        discountedUnitAmount: 600,
        durationMonths: 3,
      },
    };
    getMockStore().offerUsages.set(
      offerUsageKey(operation.guildId, "basic_intro_v1", "test"),
      offerUsageSchema.parse({
        guildId: operation.guildId,
        mode: "test",
        offerId: "basic_intro_v1",
        revision: "reserved",
        state: "reserved",
        operationId: operation.operationId,
        reservedAt: operation.createdAt * 1000,
        terms: operation.target.offer.terms,
      }),
    );
  }
  getMockStore().billingChangeOperations.set(
    `CHANGE_OP#${operation.guildId}#${operation.operationId}`,
    operation,
  );
  f.renewal.parent = {
    type: "subscription_details",
    quote_details: null,
    subscription_details: {
      subscription: f.subscription.id,
      metadata: { chronote_change_operation: operation.operationId },
    },
  };
  getMockStore().billingChangeControls.set(
    `CHANGE_CONTROL#${operation.guildId}`,
    { operationId: operation.operationId },
  );
  return { f, operation };
}
test.each([false, true])(
  "cancels an applied unpaid schedule and releases its old operation control (offer=%s)",
  async (withOffer) => {
    const { f, operation } = await scheduledFixture(withOffer);
    const grace = await f.refresh();
    if (!grace || grace.state !== "grace") throw new Error("Expected grace");
    const payer = jest
      .spyOn(renewalPayer, "assertStripePayer")
      .mockResolvedValue();
    const provider = jest
      .spyOn(renewalProvider, "cancelUnpaidRenewal")
      .mockImplementation(async (input) => {
        if (input.recovery.state !== "canceling")
          throw new Error("Expected cancellation");
        f.subscription.status = "canceled";
        f.subscription.metadata.chronote_renewal_recovery = renewalRecoveryKey(
          input.recovery,
        );
        await input.onReceipt({
          ...input.recovery,
          revision: "native-canceled",
          receipts: {
            ...input.recovery.receipts,
            creditNoteId: "cn_owned",
            canceled: true,
            collectionRestored: true,
            collectionToRestore: [],
          },
        });
        return "canceled";
      });
    try {
      const result = await cancelBillingChange({
        stripe: f.stripe,
        guildId: operation.guildId,
        payerId: operation.payerId,
        operationId: operation.operationId,
        now: paidEndsAt + 4001,
      });
      expect(result).toMatchObject({ state: "canceled" });
      if (withOffer)
        expect(
          getMockStore().offerUsages.get(
            offerUsageKey(operation.guildId, "basic_intro_v1", "test"),
          ),
        ).toMatchObject({
          state: "unused",
          released: {
            reason: "schedule_canceled",
            operationId: operation.operationId,
          },
        });
      expect(
        await classifyChangeHistory(f.renewal, {
          guildId: operation.guildId,
          mode: "test",
          accountId: "acct_owned",
          createdBefore: paidEndsAt + 8000,
        }),
      ).toEqual({ kind: "ordinary" });
      expect(
        getMockStore().billingChangeOperations.get(
          `CHANGE_OP#${operation.guildId}#${operation.operationId}`,
        ),
      ).toMatchObject({ state: "canceled", reconciled: true });
      expect(
        getMockStore().billingChangeControls.has(
          `CHANGE_CONTROL#${operation.guildId}`,
        ),
      ).toBe(false);
      expect(
        getMockStore().renewalRecoveryPointers.get(operation.guildId)?.blocking,
      ).toBe(false);
      expect(
        await getRenewalRecoveryRepository().getCurrent(operation.guildId),
      ).toMatchObject({ state: "canceled", endsAt: grace.endsAt });
    } finally {
      payer.mockRestore();
      provider.mockRestore();
    }
  },
);

test("billing status exposes the same verified invoice only to the original payer", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  f.renewal.hosted_invoice_url = "https://invoice.stripe.com/i/owned";
  const grace = await f.refresh();
  if (!grace || grace.state !== "grace") throw new Error("Expected grace");
  const input = {
    stripe: f.stripe,
    guildId: grace.guildId,
    now: paidEndsAt + 4001,
  };
  expect(
    await getRenewalRecoveryView({ ...input, payerId: grace.payerId }),
  ).toMatchObject({
    status: "grace",
    priorTier: "basic",
    selectedTier: "basic",
    amountDue: 1000,
    paymentUrl: f.renewal.hosted_invoice_url,
    canManage: true,
  });
  const other = await getRenewalRecoveryView({
    ...input,
    payerId: "another-payer",
  });
  expect(other).toMatchObject({
    status: "grace",
    paymentUrl: null,
    canManage: false,
  });
  expect(other).not.toHaveProperty("subscriptionId");
  expect(other).not.toHaveProperty("invoiceId");
});
test("billing status names the selected Basic plan separately from prior Pro access", async () => {
  const { f, operation } = await scheduledFixture();
  await f.refresh();
  expect(
    await getRenewalRecoveryView({
      stripe: f.stripe,
      guildId: operation.guildId,
      payerId: operation.payerId,
      now: paidEndsAt + 4001,
    }),
  ).toMatchObject({
    status: "grace",
    priorTier: "pro",
    selectedTier: "basic",
    scheduledChange: true,
  });
});
test("billing status hides the payment URL after cancellation starts and at expiry", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const grace = await f.refresh();
  if (!grace || grace.state !== "grace") throw new Error("Expected grace");
  expect(
    await getRenewalRecoveryView({
      stripe: f.stripe,
      guildId: grace.guildId,
      payerId: grace.payerId,
      now: grace.endsAt,
    }),
  ).toMatchObject({ status: "reconciling", paymentUrl: null });
  const provider = jest
    .spyOn(renewalProvider, "cancelUnpaidRenewal")
    .mockRejectedValue(new Error("Provider unavailable"));
  try {
    await expect(
      reconcileRenewalRecovery({
        stripe: f.stripe,
        guildId: grace.guildId,
        now: grace.endsAt,
      }),
    ).rejects.toThrow();
    expect(
      await getRenewalRecoveryView({
        stripe: f.stripe,
        guildId: grace.guildId,
        payerId: grace.payerId,
        now: grace.endsAt,
      }),
    ).toMatchObject({ status: "reconciling", paymentUrl: null });
  } finally {
    provider.mockRestore();
  }
});

test("disabled coverage binds the original deadline without access enforcement or financial cleanup", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  config.stripe.renewalGraceEnabled = false;
  const record = await f.refresh();
  if (!record || record.state !== "grace")
    throw new Error("Expected bound coverage");
  const provider = jest.spyOn(renewalProvider, "cancelUnpaidRenewal");
  await reconcileRenewalRecovery({
    stripe: f.stripe,
    guildId: record.guildId,
    now: record.endsAt + 500,
  });
  expect(provider).not.toHaveBeenCalled();
  provider.mockRestore();
  config.stripe.renewalGraceEnabled = true;
  expect(await f.refresh(record.endsAt + 1000)).toMatchObject({
    state: "grace",
    enforcementAccepted: true,
    endsAt: record.endsAt,
  });
});

test("the normal paid writer records coverage before acknowledgment while enforcement is off", async () => {
  const f = fixture();
  config.stripe.renewalGraceEnabled = false;
  await reconcileSubscription(
    f.stripe,
    renewalSubscription.guildId,
    f.subscription.id,
  );
  expect(
    await getRenewalRecoveryRepository().getCurrent(
      renewalSubscription.guildId,
    ),
  ).toMatchObject({
    state: "watching",
    writerVersion: "renewal-grace-v1",
    enforcementAccepted: false,
    paid: { invoiceId: fundedInvoice.id },
  });
});

test("a credit-note-paid invoice cannot project active service during cancellation", async () => {
  const f = fixture();
  await f.track();
  f.fail();
  const grace = await f.refresh();
  if (!grace || grace.state !== "grace") throw new Error("Expected grace");
  const provider = jest
    .spyOn(renewalProvider, "cancelUnpaidRenewal")
    .mockRejectedValue(new Error("Cancellation unavailable"));
  try {
    await expect(
      reconcileRenewalRecovery({
        stripe: f.stripe,
        guildId: grace.guildId,
        now: grace.endsAt,
      }),
    ).rejects.toThrow();
  } finally {
    provider.mockRestore();
  }
  const previous = { ...getMockStore().subscriptions.get(grace.guildId) };
  f.subscription.status = "active";
  f.renewal.status = "paid";
  f.renewal.amount_remaining = 0;
  f.renewal.pre_payment_credit_notes_amount = 1000;
  await reconcileSubscription(f.stripe, grace.guildId, grace.subscriptionId);
  expect(getMockStore().subscriptions.get(grace.guildId)).toEqual(previous);
});
