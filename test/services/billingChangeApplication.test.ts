/** @jest-environment node */
import {
  buildChangeApplicationRequest,
  inspectChangeApplication,
} from "../../src/services/billingChangeApplication";
import { changeOperation } from "../fixtures/billingChange";
import { billingChangeBase } from "../../src/types/billingChange";
import { sourceSubscription, fundedInvoice } from "../fixtures/renewalStripe";
const operation = {
  ...billingChangeBase(changeOperation),
  state: "applying" as const,
  consent: { at: 1700000010, quoteRevision: "approved" },
  funding: {
    invoiceId: "in_funding",
    total: 900,
    amountDue: 900,
    currency: "usd",
    startingBalance: 0,
    endingBalance: 0,
    serviceValue: 900,
  },
};
it.each(["classic", "flexible"] as const)(
  "preserves %s billing mode and removes Basic discounts for Pro",
  (mode) => {
    const request = buildChangeApplicationRequest({
      ...operation,
      source: { ...operation.source, billingMode: mode },
    });
    expect(request).toMatchObject({
      items: [
        {
          id: operation.source.itemId,
          price: operation.target.priceId,
          quantity: 1,
        },
      ],
      discounts: "",
      proration_behavior: "always_invoice",
      proration_date: 1700000000,
      payment_behavior: "default_incomplete",
      metadata: { chronote_change_operation: operation.operationId },
    });
    expect(request).not.toHaveProperty("billing_mode");
    expect(request).not.toHaveProperty("billing_cycle_anchor");
    expect(request.add_invoice_items?.[0]).toMatchObject({
      discountable: false,
      price_data: { unit_amount: -900, tax_behavior: "inclusive" },
    });
  },
);
it("starts a full new year without recalculating the approved unused source credit", () => {
  const request = buildChangeApplicationRequest({
    ...operation,
    target: {
      ...operation.target,
      selection: { ...operation.target.selection, interval: "year" },
    },
  });
  expect(request).toMatchObject({
    billing_cycle_anchor: "now",
    proration_behavior: "none",
  });
  expect(request).not.toHaveProperty("proration_date");
  expect(request.add_invoice_items?.[0].price_data?.unit_amount).toBe(-1200);
});
it("never accepts an application invoice as an extra payment", () => {
  const subscription = {
    ...sourceSubscription,
    id: operation.source.subscriptionId,
    customer: operation.source.customerId,
    billing_mode: { type: operation.source.billingMode, flexible: null },
    metadata: {
      guild_id: operation.guildId,
      chronote_change_operation: operation.operationId,
    },
    items: {
      ...sourceSubscription.items,
      data: [
        {
          ...sourceSubscription.items.data[0],
          id: operation.source.itemId,
          current_period_end: operation.source.periodEnd,
          price: {
            ...sourceSubscription.items.data[0].price,
            id: operation.target.priceId ?? "",
          },
        },
      ],
    },
    discounts: [],
  };
  const invoice = {
    ...fundedInvoice,
    id: "in_application",
    customer: operation.source.customerId,
    total: 0,
    amount_due: 0,
    amount_paid: 0,
    amount_remaining: 0,
    parent: {
      ...fundedInvoice.parent,
      type: "subscription_details" as const,
      subscription_details: {
        subscription: subscription.id,
        metadata: {},
        subscription_proration_date: null,
      },
      quote_details: null,
    },
  };
  expect(inspectChangeApplication(subscription, invoice, operation)).toBe(
    "applied",
  );
  expect(
    inspectChangeApplication(
      subscription,
      { ...invoice, total: 500, amount_due: 500 },
      operation,
    ),
  ).toBe("unknown");
  expect(
    inspectChangeApplication(
      subscription,
      {
        ...invoice,
        status: "open",
        amount_due: 500,
        amount_remaining: 500,
        starting_balance: 500,
        auto_advance: false,
        attempt_count: 0,
        next_payment_attempt: null,
      },
      operation,
    ),
  ).toBe("residual_balance");
  expect(
    inspectChangeApplication(
      { ...subscription, customer: "cus_other" },
      invoice,
      operation,
    ),
  ).toBe("unknown");
});
