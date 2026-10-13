/** @jest-environment node */
import { pricingRouter } from "../../src/trpc/routers/pricing";
import { config } from "../../src/services/configService";
import { getStripeClient } from "../../src/services/stripeClient";
import type { StripeClient } from "../../src/types/stripe";
import type { TrpcContext } from "../../src/trpc/context";

jest.mock("../../src/services/stripeClient", () => ({
  getStripeClient: jest.fn(),
}));
const originalMock = config.mock.enabled;
const originalSettings = { ...config.stripe.basicIntroOffer };
afterEach(() => {
  config.mock.enabled = originalMock;
  Object.assign(config.stripe.basicIntroOffer, originalSettings);
  jest.useRealTimers();
});
const caller = () => pricingRouter.createCaller({} as TrpcContext);

test("mock pricing preserves regular fixtures with no active offer", async () => {
  config.mock.enabled = true;
  const result = await caller().plans();
  expect(
    result.plans.find(
      (plan) => plan.tier === "basic" && plan.interval === "month",
    )?.unitAmount,
  ).toBe(1200);
  expect(result.introOffer).toEqual({ status: "inactive" });
  expect(result.annualIntroOffer).toEqual({ status: "inactive" });
});

test.each([true, false])(
  "public pricing advertises only verified provider terms, coupon valid %s",
  async (valid) => {
    config.mock.enabled = false;
    jest.useFakeTimers({ now: Date.parse("2026-10-12T12:00:00Z") });
    Object.assign(config.stripe.basicIntroOffer, {
      couponId: "coupon_intro",
      annualCouponId: "coupon_annual",
      startsAt: "2026-10-01T00:00:00Z",
      enrollmentEndsAt: "",
      portalConfigurationId: "bpc_intro",
    });
    const price = {
      id: "price_basic",
      active: true,
      livemode: false,
      currency: "usd",
      unit_amount: 1000,
      lookup_key: config.stripe.lookupKeys.basicMonthly,
      billing_scheme: "per_unit",
      type: "recurring",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
      product: "prod_basic",
    };
    const annualPrice = {
      ...price,
      id: "price_annual",
      unit_amount: 10000,
      lookup_key: config.stripe.lookupKeys.basicAnnual,
      recurring: { ...price.recurring, interval: "year" },
    };
    const stripe = {
      prices: {
        list: jest.fn(async () => ({ data: [price, annualPrice] })),
        retrieve: jest.fn(async (id: string) =>
          id === annualPrice.id ? annualPrice : price,
        ),
      },
      coupons: {
        retrieve: jest.fn(async (id: string) => ({
          id,
          valid,
          livemode: false,
          percent_off: 40,
          amount_off: null,
          currency: null,
          duration: id === "coupon_annual" ? "once" : "repeating",
          duration_in_months: id === "coupon_annual" ? null : 3,
          redeem_by: null,
        })),
      },
      billingPortal: {
        configurations: {
          retrieve: jest.fn(async () => ({
            id: "bpc_intro",
            active: true,
            livemode: false,
            features: {
              subscription_update: { enabled: false },
              payment_method_update: { enabled: true },
              subscription_cancel: { enabled: true },
            },
          })),
        },
      },
    };
    jest
      .mocked(getStripeClient)
      .mockReturnValue(stripe as unknown as StripeClient);
    const result = await caller().plans();
    expect(result.introOffer).toMatchObject({
      status: valid ? "available" : "unavailable",
    });
    if (valid)
      expect(result.introOffer).toMatchObject({ enrollmentEndsAt: null });
    expect(result.introOffer).not.toHaveProperty("couponId");
    expect(result.annualIntroOffer).toMatchObject({
      status: valid ? "available" : "unavailable",
    });
    if (valid)
      expect(result.annualIntroOffer).toMatchObject({
        id: "basic_annual_intro_v1",
        discountedUnitAmount: 6000,
        enrollmentEndsAt: null,
      });
    expect(result.annualIntroOffer).not.toHaveProperty("couponId");
  },
);
