/** @jest-environment node */
import {
  readBillingChange,
  confirmBillingChange,
  prepareBillingChange,
} from "../../src/services/billingChangeService";
import { getBillingChangeRepository } from "../../src/repositories/billingChangeRepository";
import { billingChangeBase } from "../../src/types/billingChange";
import { changeOperation, changePointer } from "../fixtures/billingChange";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import { config } from "../../src/services/configService";
import {
  sourceSubscription,
  fundedInvoice,
  remainingDiscount,
} from "../fixtures/renewalStripe";
import { renewalPayerId, renewalSubscription } from "../fixtures/renewal";
import { renewalStripeClientFixture } from "../fixtures/renewalStripeClient";
import { stripeTransport } from "../fixtures/stripeTransport";
const previous = {
  mock: config.mock.enabled,
  enabled: config.stripe.subscriptionTransitionsEnabled,
};
beforeEach(() => {
  config.mock.enabled = true;
  config.stripe.subscriptionTransitionsEnabled = false;
  resetMockStore();
  getMockStore().subscriptions.set(
    changeOperation.guildId,
    structuredClone(changePointer),
  );
});
afterEach(() => {
  config.mock.enabled = previous.mock;
  config.stripe.subscriptionTransitionsEnabled = previous.enabled;
});
function seedReview(amountDue = 0) {
  const operation = {
    ...billingChangeBase(changeOperation),
    state: "review" as const,
    funding: {
      invoiceId: "in_funding",
      total: 900,
      amountDue,
      currency: "usd",
      startingBalance: -900,
      endingBalance: 0,
      serviceValue: 900,
    },
  };
  getMockStore().billingChangeOperations.set(
    `CHANGE_OP#${operation.guildId}#${operation.operationId}`,
    operation,
  );
  getMockStore().billingChangeControls.set(
    `CHANGE_CONTROL#${operation.guildId}`,
    { operationId: operation.operationId },
  );
  return operation;
}
it("keeps new changes gated without touching Stripe", async () => {
  const f = stripeTransport(() => {
    throw new Error("Unexpected Stripe request");
  });
  const context = {
    stripe: f.stripe,
    guildId: changeOperation.guildId,
    payerId: changeOperation.payerId,
  };
  expect(await readBillingChange(context)).toEqual({
    kind: "none",
    enabled: false,
  });
  await expect(
    prepareBillingChange({
      ...context,
      selection: { tier: "pro", interval: "month", expectedOffer: "none" },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(f.requests).toHaveLength(0);
});
it("does not expose another payer's pending invoice", async () => {
  const operation = seedReview(900);
  const f = stripeTransport(() => {
    throw new Error("Unexpected Stripe request");
  });
  await expect(
    readBillingChange({
      stripe: f.stripe,
      guildId: operation.guildId,
      payerId: "another-payer",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.requests).toHaveLength(0);
});
it("rejects stale approval before provider mutation", async () => {
  const operation = seedReview();
  const f = stripeTransport(() => {
    throw new Error("Unexpected Stripe request");
  });
  await expect(
    confirmBillingChange({
      stripe: f.stripe,
      guildId: operation.guildId,
      payerId: operation.payerId,
      operationId: operation.operationId,
      revision: "stale",
      now: operation.createdAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (
      await getBillingChangeRepository().getOperation(
        operation.guildId,
        operation.operationId,
      )
    )?.state,
  ).toBe("review");
  expect(f.requests).toHaveLength(0);
});
it("does not apply a zero-cash invoice before explicit confirmation", async () => {
  const operation = seedReview();
  const f = stripeTransport(() => {
    throw new Error("Unexpected Stripe request");
  });
  const view = await readBillingChange({
    stripe: f.stripe,
    guildId: operation.guildId,
    payerId: operation.payerId,
    now: operation.createdAt,
  });
  expect(view).toMatchObject({
    kind: "operation",
    state: "review",
    paymentUrl: null,
  });
  expect(f.requests).toHaveLength(0);
});

it("keeps Basic through review and incomplete payment, then applies one settled upgrade and survives replay", async () => {
  config.stripe.subscriptionTransitionsEnabled = true;
  const guildId = changeOperation.guildId;
  getMockStore().subscriptions.set(guildId, {
    ...renewalSubscription,
    stripeCustomerId: "cus_renewal",
  });
  const baseline = renewalStripeClientFixture();
  const customer = await baseline.stripe.customers.retrieve("cus_renewal");
  if (customer.deleted) throw new Error("Expected full customer fixture");
  const baseItem = sourceSubscription.items.data[0];
  const basic = { ...baseItem.price, tax_behavior: "inclusive" as const };
  const pro = {
    ...basic,
    id: "price_pro_monthly",
    unit_amount: 2400,
    lookup_key: "chronote_pro_monthly",
  };
  let provider = {
    ...sourceSubscription,
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      ...sourceSubscription.items,
      data: [{ ...baseItem, price: basic }],
    },
    discounts: [remainingDiscount],
  };
  const now = Math.floor(
    (baseItem.current_period_start + baseItem.current_period_end) / 2,
  );
  const credit = {
    ...fundedInvoice.lines.data[0],
    id: "il_credit",
    amount: -300,
    parent: {
      ...fundedInvoice.lines.data[0].parent,
      type: "subscription_item_details" as const,
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        subscription: "sub_renewal",
        subscription_item: baseItem.id,
        proration: true,
        proration_details: { credited_items: null },
      },
    },
  };
  const debit = {
    ...credit,
    id: "il_debit",
    amount: 1200,
    pricing: {
      ...credit.pricing,
      type: "price_details" as const,
      price_details: { price: pro.id, product: "prod_renewal" },
      unit_amount_decimal: credit.pricing?.unit_amount_decimal ?? null,
    },
  };
  let funding = {
    ...fundedInvoice,
    id: "in_change",
    parent: null,
    customer: "cus_renewal",
    status: "draft" as const,
    auto_advance: false,
    total: 900,
    amount_due: 900,
    amount_remaining: 900,
    amount_paid: 0,
    starting_balance: 0,
    ending_balance: 0,
    metadata: {} as Record<string, string>,
    lines: {
      ...fundedInvoice.lines,
      data: [] as typeof fundedInvoice.lines.data,
    },
  };
  let fundingPaid = false;
  let fundingFinalized = false;
  const application = {
    ...fundedInvoice,
    id: "in_application",
    total: 0,
    amount_due: 0,
    amount_remaining: 0,
    amount_paid: 0,
  };
  const f = stripeTransport(({ path, method, fields }) => {
    if (path === "/v1/customers/cus_renewal") return customer;
    if (path === "/v1/subscriptions/sub_renewal" && method === "GET")
      return provider;
    if (path === "/v1/prices")
      return { object: "list", data: [basic, pro], has_more: false };
    if (path === "/v1/prices/price_pro_monthly") return pro;
    if (path === "/v1/invoices/in_funded")
      return {
        ...fundedInvoice,
        total: 600,
        amount_due: 600,
        amount_paid: 600,
        lines: {
          ...fundedInvoice.lines,
          data: [
            {
              ...fundedInvoice.lines.data[0],
              discount_amounts: [
                { amount: 400, discount: remainingDiscount.id },
              ],
            },
          ],
        },
      };
    if (path === "/v1/invoices/create_preview")
      return {
        ...fundedInvoice,
        total: 900,
        amount_due: 900,
        amount_paid: 0,
        lines: { ...fundedInvoice.lines, data: [credit, debit] },
      };
    if (path === "/v1/invoices" && method === "POST") {
      funding = {
        ...funding,
        metadata: {
          guild_id: guildId,
          chronote_change_operation:
            fields.get("metadata[chronote_change_operation]") ?? "",
          chronote_invoice_role: "funding",
        },
      };
      return funding;
    }
    if (path === "/v1/invoiceitems")
      return { id: "ii_owned", object: "invoiceitem" };
    if (path === "/v1/invoices/in_change/finalize") {
      fundingFinalized = true;
      funding = {
        ...funding,
        subtotal: 900,
        lines: {
          ...funding.lines,
          data: [
            {
              ...fundedInvoice.lines.data[0],
              amount: 1200,
              discount_amounts: [],
              metadata: { chronote_change_part: "target-service" },
            },
            {
              ...fundedInvoice.lines.data[0],
              amount: -300,
              discount_amounts: [],
              metadata: { chronote_change_part: "unused-service" },
            },
          ],
        },
      };
      return {
        ...funding,
        status: "open",
        hosted_invoice_url: "https://invoice.stripe.com/i/fixture",
      };
    }
    if (path === "/v1/invoices/in_change")
      return {
        ...funding,
        status: fundingPaid ? "paid" : fundingFinalized ? "open" : "draft",
        amount_paid: fundingPaid ? 900 : 0,
        amount_remaining: fundingPaid ? 0 : 900,
        hosted_invoice_url: "https://invoice.stripe.com/i/fixture",
      };
    if (path === "/v1/subscriptions/sub_renewal" && method === "POST") {
      expect(fields.get("discounts")).toBe("");
      expect(fields.get("items[0][price]")).toBe(pro.id);
      expect(fields.get("add_invoice_items[0][price_data][unit_amount]")).toBe(
        "-900",
      );
      provider = {
        ...provider,
        items: {
          ...provider.items,
          data: [{ ...provider.items.data[0], price: pro }],
        },
        discounts: [],
        latest_invoice: "in_application",
        metadata: {
          ...provider.metadata,
          chronote_change_operation: funding.metadata.chronote_change_operation,
        },
      };
      return provider;
    }
    if (path === "/v1/invoices/in_application") return application;
    throw new Error(`Unexpected ${method} ${path}`);
  });
  const context = { stripe: f.stripe, guildId, payerId: renewalPayerId, now };
  const review = await prepareBillingChange({
    ...context,
    selection: { tier: "pro", interval: "month", expectedOffer: "none" },
  });
  expect(review).toMatchObject({
    kind: "operation",
    state: "review",
    paymentUrl: null,
    quote: { amountDue: 900, unusedCredit: 300, planCharge: 1200 },
  });
  expect(provider.items.data[0].price.id).toBe(basic.id);
  if (review.kind !== "operation") throw new Error("Expected review");
  const accepted = await confirmBillingChange({
    ...context,
    operationId: review.operationId,
    revision: review.revision,
  });
  expect(accepted).toMatchObject({
    state: "accepted",
    paymentUrl: "https://invoice.stripe.com/i/fixture",
  });
  expect(provider.items.data[0].price.id).toBe(basic.id);
  expect(await readBillingChange(context)).toMatchObject({ state: "accepted" });
  fundingPaid = true;
  expect(await readBillingChange(context)).toMatchObject({
    state: "succeeded",
  });
  expect(getMockStore().subscriptions.get(guildId)).toMatchObject({
    tier: "pro",
    stripeSubscriptionId: "sub_renewal",
  });
  expect(await readBillingChange(context)).toEqual({
    kind: "none",
    enabled: true,
  });
  expect(
    f.requests.filter(
      (request) =>
        request.path === "/v1/subscriptions/sub_renewal" &&
        request.method === "POST",
    ),
  ).toHaveLength(1);
  expect(f.requests.some((request) => request.path.endsWith("/pay"))).toBe(
    false,
  );
  expect(baseline.update).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
