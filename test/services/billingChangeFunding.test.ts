/** @jest-environment node */
import Stripe from "stripe";
import {
  finalizeChangeFunding,
  verifyChangeFunding,
} from "../../src/services/billingChangeFunding";
import { response } from "../fixtures/renewalStripeClient";
import { fundedInvoice, sourceSubscription } from "../fixtures/renewalStripe";
import { changeOperation } from "../fixtures/billingChange";
import { billingChangeBase } from "../../src/types/billingChange";
const preparing = {
  ...billingChangeBase(changeOperation),
  state: "preparing" as const,
  draftInvoiceId: "in_funding",
};
function invoice(status: "draft" | "open" | "paid", balance = -200) {
  const service =
    preparing.quote.planCharge -
    preparing.quote.offerSavings -
    preparing.quote.unusedCredit;
  return {
    ...fundedInvoice,
    id: "in_funding",
    status,
    parent: null,
    customer: preparing.source.customerId,
    metadata: {
      chronote_change_operation: preparing.operationId,
      guild_id: preparing.guildId,
      chronote_invoice_role: "funding",
    },
    auto_advance: false,
    total: service,
    amount_due: service + balance,
    amount_paid: status === "paid" ? service + balance : 0,
    amount_remaining: status === "paid" ? 0 : service + balance,
    starting_balance: balance,
    ending_balance: 0,
    lines: { ...fundedInvoice.lines, data: [] },
  };
}
afterEach(() => jest.restoreAllMocks());
it("finalizes one owned invoice before consent without charging or mutating the subscription", async () => {
  const stripe = new Stripe("sk_test_fixture");
  const draft = invoice("draft");
  const open = invoice("open");
  const retrieve = jest
    .spyOn(stripe.invoices, "retrieve")
    .mockResolvedValue(response(draft));
  const finalize = jest
    .spyOn(stripe.invoices, "finalizeInvoice")
    .mockResolvedValue(response(open));
  const items = jest.spyOn(stripe.invoiceItems, "create").mockResolvedValue(
    response({
      id: "ii_owned",
      object: "invoiceitem",
      amount: 1200,
      currency: "usd",
      customer: "cus_test",
      customer_account: null,
      date: 1700000000,
      description: null,
      discountable: false,
      discounts: [],
      invoice: "in_funding",
      livemode: false,
      metadata: {},
      net_amount: 1200,
      parent: null,
      period: { start: 1700000000, end: 1701000000 },
      pricing: null,
      proration: false,
      quantity: 1,
      tax_rates: [],
      test_clock: null,
    }),
  );
  const pay = jest.spyOn(stripe.invoices, "pay");
  const update = jest.spyOn(stripe.subscriptions, "update");
  const result = await finalizeChangeFunding({
    stripe,
    operation: preparing,
    subscription: sourceSubscription,
  });
  expect(result.funding).toMatchObject({
    invoiceId: "in_funding",
    amountDue: 700,
    total: 900,
    startingBalance: -200,
  });
  expect(result.quote).toMatchObject({ amountDue: 700, billingBalance: -200 });
  expect(items.mock.calls.map(([params]) => params.amount)).toEqual([
    1200, -300,
  ]);
  expect(
    items.mock.calls.every(([, options]) => Boolean(options?.idempotencyKey)),
  ).toBe(true);
  expect(finalize).toHaveBeenCalledWith(
    "in_funding",
    { auto_advance: false },
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  );
  expect(pay).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(retrieve).toHaveBeenCalledWith("in_funding");
});
it("binds the settled invoice and exact amount despite a later account balance change", () => {
  const paid = invoice("paid");
  const funding = {
    invoiceId: paid.id,
    total: 900,
    amountDue: 700,
    currency: "usd",
    startingBalance: -200,
    endingBalance: 0,
    serviceValue: 900,
  };
  expect(verifyChangeFunding(paid, preparing, funding)).toBe(true);
  expect(
    verifyChangeFunding({ ...paid, amount_paid: 699 }, preparing, funding),
  ).toBe(false);
  expect(
    verifyChangeFunding(
      {
        ...paid,
        metadata: { ...paid.metadata, chronote_change_operation: "another" },
      },
      preparing,
      funding,
    ),
  ).toBe(false);
  expect(
    verifyChangeFunding({ ...paid, customer: "cus_other" }, preparing, funding),
  ).toBe(false);
});

it("discloses a below-minimum charge carried to a future invoice instead of calling it applied credit", async () => {
  const stripe = new Stripe("sk_test_fixture");
  const native = {
    ...invoice("paid", 0),
    total: 10,
    amount_due: 0,
    amount_paid: 0,
    amount_remaining: 0,
    ending_balance: 10,
  };
  jest.spyOn(stripe.invoices, "retrieve").mockResolvedValue(response(native));
  const result = await finalizeChangeFunding({
    stripe,
    operation: {
      ...preparing,
      quote: { ...preparing.quote, planCharge: 10, unusedCredit: 0 },
    },
    subscription: sourceSubscription,
  });
  expect(result.quote).toMatchObject({
    amountDue: 0,
    billingBalance: 0,
    balanceCarriedForward: 10,
  });
  expect(verifyChangeFunding(native, preparing, result.funding)).toBe(true);
});
