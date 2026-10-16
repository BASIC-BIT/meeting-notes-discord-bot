/** @jest-environment node */
import { cancelUnpaidRenewal } from "../../src/services/renewalRecoveryProvider";
import {
  renewalRecoverySchema,
  renewalRecoveryKey,
  type RenewalRecovery,
} from "../../src/types/renewalRecovery";
import { config } from "../../src/services/configService";
import {
  sourceSubscription,
  fundedInvoice,
  paidStartsAt,
  paidEndsAt,
} from "../fixtures/renewalStripe";
import { stripeTransport } from "../fixtures/stripeTransport";

const originalMode = config.subscription.stripeMode;
beforeEach(() => {
  config.subscription.stripeMode = "test";
});
afterEach(() => {
  config.subscription.stripeMode = originalMode;
});
function fixture(cash = 0, post = 0, tax = 0) {
  const native = {
    ...sourceSubscription,
    metadata: { ...sourceSubscription.metadata },
    status: "past_due" as typeof sourceSubscription.status,
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      ...sourceSubscription.items,
      data: sourceSubscription.items.data.map((item) => ({
        ...item,
        current_period_start: paidEndsAt,
        current_period_end: paidEndsAt + 2592000,
      })),
    },
  };
  const invoice = {
    ...fundedInvoice,
    id: "in_renewal",
    metadata: {},
    status: "open" as typeof fundedInvoice.status,
    amount_paid: cash,
    amount_remaining: 1000 + tax - cash,
    amount_due: 1000 + tax,
    total: 1000 + tax,
    auto_advance: true,
    lines: {
      ...fundedInvoice.lines,
      data: fundedInvoice.lines.data.map((line) => ({
        ...line,
        id: "il_renewal",
        period: { start: paidEndsAt, end: paidEndsAt + 2592000 },
      })),
    },
    status_transitions: {
      ...fundedInvoice.status_transitions,
      finalized_at: paidEndsAt + 3600,
    },
  };
  const other = {
    ...fundedInvoice,
    id: "in_other",
    status: "open" as const,
    auto_advance: true,
    amount_remaining: 200,
    total: 200,
  };
  let recovery = renewalRecoverySchema.parse({
    guildId: native.metadata.guild_id,
    subscriptionId: native.id,
    customerId: "cus_renewal",
    payerId: native.metadata.discord_id,
    mode: "test",
    revision: "r1",
    paid: {
      invoiceId: fundedInvoice.id,
      priceId: "price_renewal",
      tier: "pro",
      interval: "month",
      periodStart: paidStartsAt,
      periodEnd: paidEndsAt,
    },
    scheduledOperationId: null,
    enforcementAccepted: true,
    state: "canceling",
    nextCheckAt: paidEndsAt + 4000,
    reason: "payer",
    invoice: {
      id: invoice.id,
      lineId: "il_renewal",
      finalizedAt: paidEndsAt + 3600,
      periodStart: paidEndsAt,
      periodEnd: paidEndsAt + 2592000,
    },
    endsAt: paidEndsAt + 3600 + 172800,
    receipts: { creditNoteId: null, refundIds: [], canceled: false },
  });
  const notes: object[] = [];
  let loseNoteAck = false;
  let failCancel = false;
  let loseCancelAck = false;
  let writesAfterFailedReceipt = 0;
  let processing = false;
  let payOnPause = false;
  let processingOnPause = false;
  type Request = { path: string; method: string; fields: URLSearchParams };
  function subscriptionRequest({ path, method, fields }: Request): unknown {
    if (path === "/v1/customers/cus_renewal")
      return {
        id: "cus_renewal",
        livemode: false,
        metadata: { discord_id: native.metadata.discord_id },
      };
    if (path === `/v1/subscriptions/${native.id}` && method === "GET")
      return native;
    if (path === `/v1/subscriptions/${native.id}` && method === "POST") {
      native.metadata = {
        ...native.metadata,
        chronote_renewal_recovery:
          fields.get("metadata[chronote_renewal_recovery]") ?? "",
      };
      return native;
    }
    if (path === `/v1/subscriptions/${native.id}` && method === "DELETE") {
      if (failCancel) throw new Error("Provider cancellation unavailable");
      native.status = "canceled";
      other.auto_advance = false;
      if (loseCancelAck) {
        loseCancelAck = false;
        throw new Error("Lost cancellation acknowledgement");
      }
      return native;
    }
    return undefined;
  }
  function serviceRequest({ path, method, fields }: Request): unknown {
    if (path === "/v1/invoices")
      return {
        object: "list",
        data: [invoice, other],
        has_more: false,
        url: path,
      };
    if (path === `/v1/invoices/${invoice.id}` && method === "GET")
      return invoice;
    if (path === `/v1/invoices/${other.id}` && method === "GET") return other;
    if (path.startsWith("/v1/invoices/") && method === "POST") {
      const target = path.endsWith(other.id) ? other : invoice;
      if (fields.has("auto_advance"))
        target.auto_advance = fields.get("auto_advance") === "true";
      if (payOnPause && target.id === invoice.id) {
        invoice.status = "paid";
        invoice.amount_remaining = 0;
      }
      if (processingOnPause && target.id === invoice.id) processing = true;
      return target;
    }
    return undefined;
  }
  function createNote(fields: URLSearchParams): unknown {
    const refund = Number(fields.get("refund_amount") ?? 0);
    const credit = Number(fields.get("credit_amount") ?? 0);
    expect(fields.get("lines[0][invoice_line_item]")).toBe("il_renewal");
    expect(fields.get("lines[0][quantity]")).toBe("1");
    expect(refund + credit).toBe(post);
    const note = {
      id: "cn_owned",
      status: "issued",
      invoice: invoice.id,
      customer: "cus_renewal",
      livemode: false,
      amount: 1000 + tax,
      currency: "usd",
      pre_payment_amount: 1000 + tax - post,
      post_payment_amount: post,
      metadata: {
        chronote_renewal_recovery: fields.get(
          "metadata[chronote_renewal_recovery]",
        ),
        chronote_recovery_refund: String(refund),
        chronote_recovery_credit: String(credit),
      },
      lines: {
        has_more: false,
        data: [{ invoice_line_item: "il_renewal", quantity: 1 }],
      },
      refunds: refund ? [{ refund: "re_owned", amount_refunded: refund }] : [],
      customer_balance_transaction: credit ? "cbt_owned" : null,
    };
    notes.push(note);
    invoice.pre_payment_credit_notes_amount = note.pre_payment_amount;
    invoice.post_payment_credit_notes_amount = post;
    invoice.amount_remaining = 0;
    invoice.status = "paid";
    if (loseNoteAck) {
      loseNoteAck = false;
      throw new Error("Lost credit note acknowledgement");
    }
    return note;
  }
  const transport = stripeTransport((request) => {
    const subscription = subscriptionRequest(request);
    if (subscription !== undefined) return subscription;
    const service = serviceRequest(request);
    if (service !== undefined) return service;
    const { path, method, fields } = request;
    if (path === "/v1/credit_notes" && method === "GET")
      return { object: "list", data: notes, has_more: false, url: path };
    if (path === "/v1/credit_notes/preview")
      return {
        amount: 1000 + tax,
        pre_payment_amount: 1000 + tax - post,
        post_payment_amount: post,
        currency: "usd",
        lines: {
          has_more: false,
          data: [{ invoice_line_item: "il_renewal", quantity: 1 }],
        },
      };
    if (path === "/v1/credit_notes" && method === "POST")
      return createNote(fields);
    if (path === "/v1/refunds/re_owned")
      return {
        id: "re_owned",
        status: "succeeded",
        amount: Math.min(cash, post),
        currency: "usd",
        livemode: false,
        charge: "ch_owned",
      };
    if (path === "/v1/invoice_payments")
      return {
        object: "list",
        data: [
          {
            invoice: invoice.id,
            livemode: false,
            currency: "usd",
            status: processing ? "open" : "paid",
            amount_paid: cash,
            payment: { type: "payment_intent", payment_intent: "pi_owned" },
          },
        ],
        has_more: false,
        url: path,
      };
    if (path === "/v1/payment_intents/pi_owned")
      return {
        id: "pi_owned",
        status: processing ? "processing" : "succeeded",
        customer: "cus_renewal",
        livemode: false,
        currency: "usd",
        amount_received: cash,
        latest_charge: "ch_owned",
      };
    if (path === "/v1/customers/cus_renewal/balance_transactions/cbt_owned")
      return {
        id: "cbt_owned",
        amount: -(post - Math.min(cash, post)),
        currency: "usd",
      };
    writesAfterFailedReceipt++;
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  const run = (rejectReceipt: boolean | number = false) =>
    cancelUnpaidRenewal({
      stripe: transport.stripe,
      recovery,
      now: paidEndsAt + 4000,
      onReceipt: async (next) => {
        if (
          rejectReceipt === true ||
          (typeof rejectReceipt === "number" && --rejectReceipt === 0)
        )
          throw new Error("Receipt persistence unavailable");
        recovery = next;
      },
    });
  return {
    ...transport,
    native,
    invoice,
    other,
    notes,
    run,
    get recovery() {
      return recovery;
    },
    set recovery(value: RenewalRecovery) {
      recovery = value;
    },
    processingOnPause() {
      processingOnPause = true;
    },
    processing() {
      processing = true;
    },
    payOnPause() {
      payOnPause = true;
    },
    loseNote() {
      loseNoteAck = true;
    },
    loseCancel() {
      loseCancelAck = true;
    },
    failCancellation(value: boolean) {
      failCancel = value;
    },
    get unexpected() {
      return writesAfterFailedReceipt;
    },
  };
}
test("cancels only the unpaid plan and restores unrelated automatic collection", async () => {
  const f = fixture();
  expect(await f.run()).toBe("canceled");
  expect(f.native.status).toBe("canceled");
  expect(f.other.total).toBe(200);
  expect(f.other.auto_advance).toBe(true);
  expect(f.recovery).toMatchObject({
    state: "canceling",
    receipts: { creditNoteId: "cn_owned", canceled: true },
  });
  const request = f.requests.find(
    (request) =>
      request.path === "/v1/credit_notes" && request.method === "POST",
  );
  expect(request?.fields.has("refund_amount")).toBe(false);
  expect(request?.fields.has("credit_amount")).toBe(false);
  expect(
    f.requests
      .find((request) => request.method === "DELETE")
      ?.fields.get("prorate"),
  ).toBe("false");
});
test.each([
  [300, 300, 0],
  [0, 900, 0],
  [300, 500, 0],
  [0, 0, 100],
])(
  "uses native preview allocation for cash=%s post=%s tax=%s",
  async (cash, post, tax) => {
    const f = fixture(cash, post, tax);
    expect(await f.run()).toBe("canceled");
    const request = f.requests.find(
      (request) =>
        request.path === "/v1/credit_notes" && request.method === "POST",
    );
    expect(Number(request?.fields.get("refund_amount") ?? 0)).toBe(
      Math.min(cash, post),
    );
    expect(Number(request?.fields.get("credit_amount") ?? 0)).toBe(
      post - Math.min(cash, post),
    );
  },
);
test("recovers an unacknowledged credit note without issuing it twice", async () => {
  const f = fixture();
  f.loseNote();
  await expect(f.run()).rejects.toThrow();
  expect(await f.run()).toBe("canceled");
  expect(f.notes).toHaveLength(1);
});
test("recovers cancellation after its provider acknowledgement is lost", async () => {
  const f = fixture();
  f.loseCancel();
  await expect(f.run()).rejects.toThrow();
  expect(await f.run()).toBe("canceled");
  expect(f.notes).toHaveLength(1);
  expect(f.other.auto_advance).toBe(true);
});
test("lets a payment that settled before cleanup complete the renewal", async () => {
  const f = fixture();
  f.invoice.status = "paid";
  f.invoice.amount_remaining = 0;
  expect(await f.run()).toBe("paid");
  expect(f.notes).toHaveLength(0);
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
});
test("retains its recoverable receipt when native cancellation fails", async () => {
  const f = fixture();
  f.failCancellation(true);
  await expect(f.run()).rejects.toThrow();
  expect(f.recovery).toMatchObject({
    receipts: { creditNoteId: "cn_owned", canceled: false },
  });
  f.failCancellation(false);
  expect(await f.run()).toBe("canceled");
  expect(f.notes).toHaveLength(1);
});
test("stops before financial writes when the receipt cannot be saved", async () => {
  const f = fixture();
  await expect(f.run(true)).rejects.toThrow("Receipt persistence unavailable");
  expect(f.notes).toHaveLength(0);
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
});
test("refuses cross-mode, foreign-customer and stale plan-line evidence", async () => {
  for (const mismatch of ["mode", "customer", "line"]) {
    const f = fixture();
    if (mismatch === "mode") f.invoice.livemode = true;
    if (mismatch === "customer") f.invoice.customer = "cus_other";
    if (mismatch === "line") f.invoice.lines.data[0].id = "il_other";
    await expect(f.run()).rejects.toThrow();
    expect(f.notes).toHaveLength(0);
    expect(f.requests.some((request) => request.method === "DELETE")).toBe(
      false,
    );
  }
});
test("uses a cycle-specific recovery marker", () => {
  expect(renewalRecoveryKey(fixture().recovery)).toContain("sub_renewal");
});

test("holds recovery while the same invoice payment is processing", async () => {
  const f = fixture();
  f.processing();
  expect(await f.run()).toBe("pending");
  expect(f.notes).toHaveLength(0);
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
});
test("honors payment that wins the pause race before the credit note", async () => {
  const f = fixture();
  f.payOnPause();
  expect(await f.run()).toBe("paid");
  expect(f.notes).toHaveLength(0);
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
});

test("holds cleanup when payment starts processing during invoice pause", async () => {
  const f = fixture();
  f.processingOnPause();
  expect(await f.run()).toBe("pending");
  expect(f.notes).toHaveLength(0);
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
});
test.each([1, 2, 3, 4])(
  "resumes safely after receipt %s cannot persist",
  async (stage) => {
    const f = fixture();
    await expect(f.run(stage)).rejects.toThrow(
      "Receipt persistence unavailable",
    );
    expect(await f.run()).toBe("canceled");
    expect(f.notes).toHaveLength(1);
    expect(f.recovery).toMatchObject({
      receipts: { canceled: true, collectionRestored: true },
    });
  },
);
