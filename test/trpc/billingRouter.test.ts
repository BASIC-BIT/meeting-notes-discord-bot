/** @jest-environment node */
import type { Request, Response } from "express";
import { captureEvent } from "../../src/services/analyticsService";
jest.mock("../../src/services/analyticsService", () => ({
  captureEvent: jest.fn(),
}));
import { billingRouter } from "../../src/trpc/routers/billing";
import { config } from "../../src/services/configService";
import { getMockUser } from "../../src/repositories/mockStore";
import { resolvePaidPlanPriceId } from "../../src/services/pricingService";
import {
  BillingActionError,
  createCheckoutSession,
  createPortalSession,
} from "../../src/services/billingService";

jest.mock("../../src/services/billingService", () => ({
  ...jest.requireActual("../../src/services/billingService"),
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
  resolvePromotionCodeId: jest.fn(async () => "promo_other"),
}));
jest.mock("../../src/services/stripeClient", () => ({
  getStripeClient: () => ({}),
}));
jest.mock("../../src/services/pricingService", () => ({
  resolvePaidPlanPriceId: jest.fn(async () => "price_pro"),
}));
jest.mock("../../src/trpc/permissions", () => ({
  ...jest.requireActual("../../src/trpc/permissions"),
  requireManageGuild: jest.fn(async () => undefined),
}));

const originalMock = config.mock.enabled;
const originalBasicPrice = config.stripe.priceBasic;
beforeEach(() => {
  config.mock.enabled = false;
  jest.clearAllMocks();
  config.stripe.priceBasic = originalBasicPrice;
  jest.mocked(resolvePaidPlanPriceId).mockResolvedValue("price_pro");
});
afterAll(() => {
  config.mock.enabled = originalMock;
  config.stripe.priceBasic = originalBasicPrice;
});
const caller = (dnt?: string) =>
  billingRouter.createCaller({
    req: { session: {}, headers: { dnt } } as Request,
    res: {} as Response,
    user: { ...getMockUser(), accessToken: "fixture-token" },
  });

test.each(["header", "input"])(
  "browser %s opt-out suppresses synchronous server analytics",
  async (route) => {
    jest
      .mocked(createCheckoutSession)
      .mockResolvedValue("https://checkout.stripe.com/test");
    await caller(route === "header" ? "1" : undefined).checkout({
      serverId: "111111111111111111",
      tier: "basic",
      analyticsDisabled: route === "input",
    });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ analyticsAllowed: false }),
    );
    jest
      .mocked(createCheckoutSession)
      .mockRejectedValue(new Error("provider failed"));
    await expect(
      caller(route === "header" ? "1" : undefined).checkout({
        serverId: "111111111111111111",
        tier: "basic",
        analyticsDisabled: route === "input",
      }),
    ).rejects.toThrow();
    expect(captureEvent).not.toHaveBeenCalled();
  },
);

test("missing annual pricing never uses the legacy monthly Basic price", async () => {
  config.stripe.priceBasic = "price_basic_month_legacy";
  jest.mocked(resolvePaidPlanPriceId).mockResolvedValue(null);
  await expect(
    caller().checkout({
      serverId: "111111111111111111",
      tier: "basic",
      interval: "year",
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Pricing unavailable for selected plan",
  });
  expect(createCheckoutSession).not.toHaveBeenCalled();
});

test("legacy Basic pricing remains available for a monthly request", async () => {
  config.stripe.priceBasic = "price_basic_month_legacy";
  jest.mocked(resolvePaidPlanPriceId).mockResolvedValue(null);
  jest
    .mocked(createCheckoutSession)
    .mockResolvedValue("https://checkout.stripe.com/test");
  await caller().checkout({
    serverId: "111111111111111111",
    tier: "basic",
    interval: "month",
  });
  expect(createCheckoutSession).toHaveBeenCalledWith(
    expect.objectContaining({
      priceId: "price_basic_month_legacy",
      interval: "month",
    }),
  );
});

test("checkout preserves a safe payer denial", async () => {
  jest
    .mocked(createCheckoutSession)
    .mockRejectedValue(
      new BillingActionError(
        "FORBIDDEN",
        "Only the original payer can manage this server's Stripe billing",
      ),
    );
  await expect(
    caller().checkout({ serverId: "111111111111111111", tier: "pro" }),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: expect.stringContaining("original payer"),
  });
});

test("checkout explains a recoverable subscription state", async () => {
  jest
    .mocked(createCheckoutSession)
    .mockRejectedValue(
      new BillingActionError(
        "BAD_REQUEST",
        "Resolve the existing subscription in billing management before changing plans",
      ),
    );
  await expect(
    caller().checkout({ serverId: "111111111111111111", tier: "pro" }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("billing management"),
  });
});

test("portal preserves a safe payer denial", async () => {
  jest
    .mocked(createPortalSession)
    .mockRejectedValue(
      new BillingActionError(
        "FORBIDDEN",
        "Only the original payer can manage this server's Stripe billing",
      ),
    );
  await expect(
    caller().portal({ serverId: "111111111111111111" }),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: expect.stringContaining("original payer"),
  });
});

test("unexpected provider details remain hidden", async () => {
  jest
    .mocked(createCheckoutSession)
    .mockRejectedValue(new Error("private provider detail"));
  await expect(
    caller().checkout({ serverId: "111111111111111111", tier: "pro" }),
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "Unable to create checkout session",
  });
});

test.each([
  [{ limitType: "weekly_recording", limitSurface: "auto_start" }, true],
  [{ limitType: "private-value", limitSurface: "auto_start" }, false],
  [{ limitType: "weekly_recording", limitSurface: "duration_stop" }, false],
])(
  "validates recording context before provider work %j",
  async (context, valid) => {
    jest
      .mocked(createCheckoutSession)
      .mockResolvedValue("https://checkout.stripe.com/test");
    await caller().checkout({
      serverId: "111111111111111111",
      tier: "basic",
      ...context,
    });
    const request = jest.mocked(createCheckoutSession).mock.calls[0][0];
    if (valid)
      expect(request).toMatchObject({
        limitType: "weekly_recording",
        limitSurface: "auto_start",
      });
    else {
      expect(request).not.toHaveProperty("limitType");
      expect(request).not.toHaveProperty("limitSurface");
    }
  },
);

// These tests catch missed router choice propagation and stale offer expectations.
test("checkout forwards expected offer and explicit promotion choice to the shared boundary", async () => {
  jest
    .mocked(createCheckoutSession)
    .mockResolvedValue("https://checkout.stripe.com/test");
  await caller().checkout({
    serverId: "111111111111111111",
    tier: "basic",
    expectedOffer: "none",
    offerChoice: "promotion",
    promotionCode: "OTHER",
  });
  expect(createCheckoutSession).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedOffer: "none",
      offerChoice: "promotion",
      promotionCode: "OTHER",
    }),
  );
});

test.each(["basic_intro_v1", "basic_annual_intro_v1"] as const)(
  "checkout accepts %s and defaults offer choice to automatic",
  async (expectedOffer) => {
    jest
      .mocked(createCheckoutSession)
      .mockResolvedValue("https://checkout.stripe.com/test");
    await caller().checkout({
      serverId: "111111111111111111",
      tier: "basic",
      expectedOffer,
    });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOffer,
        offerChoice: "automatic",
      }),
    );
  },
);
