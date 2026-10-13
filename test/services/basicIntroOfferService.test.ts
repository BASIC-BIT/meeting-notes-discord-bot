/** @jest-environment node */
import { config } from "../../src/services/configService";
import * as entitlementService from "../../src/services/entitlementService";
import { captureEvent } from "../../src/services/analyticsService";
jest.mock("../../src/services/analyticsService", () => ({
  captureEvent: jest.fn(),
}));

it("keeps the introductory offer inactive with no environment configuration", () => {
  expect(config.stripe).toMatchObject({
    basicIntroOffer: {
      couponId: "",
      startsAt: "",
      enrollmentEndsAt: "",
      portalConfigurationId: "",
    },
  });
});
import {
  getBasicIntroOffer,
  getGuildBasicIntroOffer,
} from "../../src/services/basicIntroOfferService";
import type { StripeClient } from "../../src/types/stripe";
import type { PaidPlan } from "../../src/types/pricing";

const now = Date.parse("2026-10-12T12:00:00Z");
const settings = {
  couponId: "coupon_intro",
  startsAt: "2026-10-01T00:00:00Z",
  enrollmentEndsAt: "2026-11-01T00:00:00Z",
  portalConfigurationId: "bpc_intro",
};
const plans: PaidPlan[] = [
  {
    tier: "basic",
    interval: "month",
    priceId: "price_basic",
    currency: "usd",
    unitAmount: 1000,
  },
];
const empty = {
  couponId: "",
  startsAt: "",
  enrollmentEndsAt: "",
  portalConfigurationId: "",
};
function fixture() {
  const price = {
    id: "price_basic",
    active: true,
    livemode: false,
    currency: "usd",
    unit_amount: 1000,
    lookup_key: config.stripe.lookupKeys.basicMonthly,
    billing_scheme: "per_unit",
    type: "recurring",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    product: "prod_basic",
  };
  const coupon = {
    id: "coupon_intro",
    valid: true,
    livemode: false,
    percent_off: 40,
    amount_off: null,
    currency: null,
    duration: "repeating",
    duration_in_months: 3,
    redeem_by: settings.enrollmentEndsAt
      ? Date.parse(settings.enrollmentEndsAt) / 1000 + 3600
      : null,
    applies_to: { products: ["prod_basic"] },
  };
  const portal = {
    id: "bpc_intro",
    active: true,
    livemode: false,
    features: {
      subscription_update: { enabled: false },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true },
    },
  };
  const stripe = {
    prices: { retrieve: jest.fn(async () => price) },
    coupons: { retrieve: jest.fn(async () => coupon) },
    billingPortal: {
      configurations: { retrieve: jest.fn(async () => portal) },
    },
  };
  return {
    price,
    coupon,
    portal,
    stripe,
    client: stripe as unknown as StripeClient,
  };
}
afterEach(() => {
  Object.assign(config.stripe.basicIntroOffer, empty);
});

test("verifies native terms before exposing the exact public offer", async () => {
  Object.assign(config.stripe.basicIntroOffer, settings);
  const { client } = fixture();
  await expect(
    getBasicIntroOffer({ stripe: client, plans, now }),
  ).resolves.toEqual({
    status: "available",
    id: "basic_intro_v1",
    priceId: "price_basic",
    currency: "usd",
    regularUnitAmount: 1000,
    discountedUnitAmount: 600,
    percentOff: 40,
    durationMonths: 3,
    enrollmentEndsAt: settings.enrollmentEndsAt,
  });
});

test.each(["couponId", "startsAt", "portalConfigurationId"])(
  "partial config missing %s is unavailable",
  async (missing) => {
    Object.assign(config.stripe.basicIntroOffer, settings, { [missing]: "" });
    await expect(
      getBasicIntroOffer({ stripe: fixture().client, plans, now }),
    ).resolves.toEqual({ status: "unavailable" });
  },
);

test.each(["invalid", "2026-10-01T00:00:00Z"])(
  "invalid or inverted end %s is unavailable",
  async (enrollmentEndsAt) => {
    Object.assign(config.stripe.basicIntroOffer, settings, {
      enrollmentEndsAt,
    });
    await expect(
      getBasicIntroOffer({ stripe: fixture().client, plans, now }),
    ).resolves.toEqual({ status: "unavailable" });
  },
);

test.each([
  ["not started", Date.parse("2026-09-30T23:59:59Z"), "inactive"],
  ["cutoff", Date.parse(settings.enrollmentEndsAt), "expired"],
] as const)("%s offer cannot enroll", async (_, instant, status) => {
  Object.assign(config.stripe.basicIntroOffer, settings);
  await expect(
    getBasicIntroOffer({ stripe: fixture().client, plans, now: instant }),
  ).resolves.toEqual({ status });
});

test.each([
  { active: false },
  { livemode: true },
  { currency: "eur" },
  { unit_amount: 1200 },
  { billing_scheme: "tiered" },
  {
    recurring: { interval: "year", interval_count: 1, usage_type: "licensed" },
  },
  {
    recurring: { interval: "month", interval_count: 2, usage_type: "licensed" },
  },
  {
    recurring: { interval: "month", interval_count: 1, usage_type: "metered" },
  },
])("rejects wrong native price %p", async (change) => {
  Object.assign(config.stripe.basicIntroOffer, settings);
  const { price, client } = fixture();
  Object.assign(price, change);
  await expect(
    getBasicIntroOffer({ stripe: client, plans, now }),
  ).resolves.toEqual({ status: "unavailable" });
});

test.each([
  { valid: false },
  { livemode: true },
  { percent_off: 39 },
  { amount_off: 400 },
  { duration: "forever" },
  { duration_in_months: 2 },
  { redeem_by: Date.parse(settings.enrollmentEndsAt) / 1000 + 3599 },
  { applies_to: { products: ["prod_pro"] } },
  { deleted: true },
])("rejects malformed native coupon %p", async (change) => {
  Object.assign(config.stripe.basicIntroOffer, settings);
  const { coupon, client } = fixture();
  Object.assign(coupon, change);
  await expect(
    getBasicIntroOffer({ stripe: client, plans, now }),
  ).resolves.toEqual({ status: "unavailable" });
});

test.each([
  { active: false },
  { livemode: true },
  {
    features: {
      subscription_update: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true },
    },
  },
  {
    features: {
      subscription_update: { enabled: false },
      payment_method_update: { enabled: false },
      subscription_cancel: { enabled: true },
    },
  },
])("rejects unsafe native portal %p", async (change) => {
  Object.assign(config.stripe.basicIntroOffer, settings);
  const { portal, client } = fixture();
  Object.assign(portal, change);
  await expect(
    getBasicIntroOffer({ stripe: client, plans, now }),
  ).resolves.toEqual({ status: "unavailable" });
});

test("provider failure and missing Basic price never advertise an offer", async () => {
  Object.assign(config.stripe.basicIntroOffer, settings);
  const { stripe, client } = fixture();
  stripe.coupons.retrieve.mockRejectedValue(new Error("provider down"));
  await expect(
    getBasicIntroOffer({ stripe: client, plans, now }),
  ).resolves.toEqual({ status: "unavailable" });
  await expect(
    getBasicIntroOffer({ stripe: fixture().client, plans: [], now }),
  ).resolves.toEqual({ status: "unavailable" });
});
import { createCheckoutSession } from "../../src/services/billingService";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import { clearGuildSubscriptionCache } from "../../src/services/subscriptionService";
import { createManualEntitlementGrant } from "../../src/services/entitlementService";

function purchaseFixture() {
  const offer = fixture();
  const guildId = "111111111111111111";
  const checkout = {
    sessions: {
      create: jest.fn(async () => ({
        id: "cs_intro",
        status: "open",
        url: "https://checkout.stripe.com/intro",
        livemode: false,
        customer: "cus_intro",
        metadata: {
          guild_id: guildId,
          purchase_attempt_id:
            getMockStore().purchaseAttempts.get(guildId)?.attemptId,
        },
      })),
      retrieve: jest.fn(async () => ({
        id: "cs_intro",
        status: "open",
        url: "https://checkout.stripe.com/intro",
        livemode: false,
        customer: "cus_intro",
        metadata: {
          guild_id: guildId,
          purchase_attempt_id:
            getMockStore().purchaseAttempts.get(guildId)?.attemptId,
        },
      })),
    },
  };
  const stripe = {
    ...offer.stripe,
    prices: {
      ...offer.stripe.prices,
      retrieve: jest.fn(async (priceId: string) => {
        if (priceId === "price_pro")
          return {
            ...offer.price,
            id: priceId,
            lookup_key: config.stripe.lookupKeys.proMonthly,
          };
        if (priceId === "price_annual")
          return {
            ...offer.price,
            id: priceId,
            lookup_key: config.stripe.lookupKeys.basicAnnual,
            recurring: {
              interval: "year",
              interval_count: 1,
              usage_type: "licensed",
            },
          };
        return offer.price;
      }),
      list: jest.fn(async () => ({
        data: [
          { ...offer.price, lookup_key: config.stripe.lookupKeys.basicMonthly },
          {
            ...offer.price,
            id: "price_annual",
            lookup_key: config.stripe.lookupKeys.basicAnnual,
            recurring: {
              interval: "year",
              interval_count: 1,
              usage_type: "licensed",
            },
          },
          {
            ...offer.price,
            id: "price_pro",
            lookup_key: config.stripe.lookupKeys.proMonthly,
          },
        ],
      })),
    },
    promotionCodes: {
      list: jest.fn(async () => ({ data: [{ id: "promo_other" }] })),
    },
    customers: {
      list: jest.fn(async () => ({ data: [], has_more: false })),
      create: jest.fn(async () => ({ id: "cus_intro" })),
    },
    checkout,
  };
  return {
    ...offer,
    stripe,
    request: {
      stripe: stripe as unknown as StripeClient,
      guildId,
      user: { id: "payer" },
      priceId: "price_basic",
    },
  };
}

describe("authoritative initial-purchase offer", () => {
  beforeEach(() => {
    resetMockStore();
    clearGuildSubscriptionCache();
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    Object.assign(config.stripe.basicIntroOffer, settings);
  });
  afterEach(() => {
    jest.useRealTimers();
    config.subscription.forceTier = "";
    clearGuildSubscriptionCache();
  });

  test("eligible Free purchase freezes native coupon and cohort, preserving promotion analytics meaning", async () => {
    const { request } = purchaseFixture();
    await expect(
      createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
    ).resolves.toContain("checkout.stripe.com");
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout,
    ).toMatchObject({
      discounts: [{ coupon: "coupon_intro" }],
      allow_promotion_codes: undefined,
      metadata: { intro_offer_id: "basic_intro_v1" },
      subscription_data: { metadata: { intro_offer_id: "basic_intro_v1" } },
    });
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout.metadata
        ?.promo_code,
    ).toBeUndefined();
    expect(captureEvent).toHaveBeenCalledWith(
      "billing_checkout_created",
      expect.objectContaining({
        properties: expect.objectContaining({ promo_present: false }),
      }),
    );
  });

  test.each([
    "manual_comp",
    "forced",
    "legacy",
    "canceled",
    "customer_pointer",
  ])("%s server does not receive an introductory coupon", async (kind) => {
    const { request } = purchaseFixture();
    if (kind === "manual_comp")
      await createManualEntitlementGrant({
        guildId: request.guildId,
        tier: "basic",
        createdBy: "admin",
      });
    else if (kind === "forced") config.subscription.forceTier = "basic";
    else
      getMockStore().subscriptions.set(request.guildId, {
        guildId: request.guildId,
        subscriptionType: "legacy",
        tier: "free",
        status: kind === "canceled" ? "canceled" : "free",
        startDate: "2026-01-01",
        ...(kind === "customer_pointer" ? { stripeCustomerId: "cus_old" } : {}),
      });
    await expect(
      createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
    ).rejects.toThrow();
    expect(getMockStore().purchaseAttempts.size).toBe(0);
  });

  test.each(["price_annual", "price_pro"])(
    "%s remains a regular purchase",
    async (priceId) => {
      const { request } = purchaseFixture();
      await createCheckoutSession({ ...request, priceId });
      expect(
        getMockStore().purchaseAttempts.get(request.guildId)?.checkout
          .discounts,
      ).toBeUndefined();
    },
  );

  test("unverified configured sale blocks relevant Basic purchase rather than charging regular price", async () => {
    const { request, coupon } = purchaseFixture();
    coupon.percent_off = 39;
    await expect(createCheckoutSession(request)).rejects.toThrow("unavailable");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
  });

  test("automatic offer plus manual promotion requires explicit choice", async () => {
    const { request } = purchaseFixture();
    await expect(
      createCheckoutSession({
        ...request,
        promotionCodeId: "promo_other",
        promotionCode: "OTHER",
      }),
    ).rejects.toThrow("Choose");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
    await createCheckoutSession({
      ...request,
      promotionCodeId: "promo_other",
      promotionCode: "OTHER",
      offerChoice: "promotion",
      expectedOffer: "none",
    });
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout,
    ).toMatchObject({
      discounts: [{ promotion_code: "promo_other" }],
      metadata: { purchase_offer_choice: "promotion", promo_code: "OTHER" },
    });
  });

  test("stale expected regular terms reject newly available automatic offer", async () => {
    const { request } = purchaseFixture();
    await expect(
      createCheckoutSession({ ...request, expectedOffer: "none" }),
    ).rejects.toThrow("changed");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
  });

  test("lost-response retry replays frozen request after cutoff or config rotation", async () => {
    const { request, stripe } = purchaseFixture();
    jest.setSystemTime(Date.parse(settings.enrollmentEndsAt) - 1000);
    stripe.checkout.sessions.create.mockRejectedValueOnce(
      new Error("lost response"),
    );
    await expect(createCheckoutSession(request)).rejects.toThrow(
      "lost response",
    );
    const frozen = structuredClone(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout,
    );
    expect(frozen?.discounts).toEqual([{ coupon: "coupon_intro" }]);
    jest.setSystemTime(Date.parse(settings.enrollmentEndsAt) + 1000);
    Object.assign(config.stripe.basicIntroOffer, {
      couponId: "coupon_rotated",
    });
    await createCheckoutSession({
      ...request,
      analyticsAllowed: false,
      source: "discord_limit",
      limitType: "weekly_recording",
      limitSurface: "manual_start",
    });
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout,
    ).toEqual(frozen);
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.analyticsOptOut,
    ).toBe(true);
    expect(stripe.checkout.sessions.create.mock.calls[1]).toEqual(
      stripe.checkout.sessions.create.mock.calls[0],
    );
  });

  test("new reservation at the cutoff cannot obtain the coupon", async () => {
    const { request } = purchaseFixture();
    jest.setSystemTime(Date.parse(settings.enrollmentEndsAt));
    await expect(
      createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
    ).rejects.toThrow("changed");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
    await createCheckoutSession(request);
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout.discounts,
    ).toBeUndefined();
  });

  test("another payer and competing promotion cannot rewrite the frozen offer", async () => {
    const { request } = purchaseFixture();
    await createCheckoutSession(request);
    const attempt = structuredClone(
      getMockStore().purchaseAttempts.get(request.guildId),
    );
    await expect(
      createCheckoutSession({ ...request, user: { id: "other" } }),
    ).rejects.toThrow("already in progress");
    await expect(
      createCheckoutSession({
        ...request,
        promotionCodeId: "promo_other",
        offerChoice: "promotion",
      }),
    ).rejects.toThrow();
    expect(getMockStore().purchaseAttempts.get(request.guildId)).toEqual(
      attempt,
    );
  });
});
import {
  createPortalSession,
  getBillingSnapshot,
} from "../../src/services/billingService";

describe("existing native introductory discount", () => {
  function subscriberFixture() {
    const base = purchaseFixture();
    const discount = {
      id: "di_intro",
      end: Date.parse("2027-01-12T12:00:00Z") / 1000,
      start: now / 1000,
      source: { type: "coupon", coupon: base.coupon },
      promotion_code: null,
    };
    const subscription = {
      id: "sub_intro",
      status: "active",
      livemode: false,
      customer: "cus_intro",
      metadata: {
        guild_id: base.request.guildId,
        intro_offer_id: "basic_intro_v1",
        intro_offer_coupon_id: "coupon_intro",
        intro_offer_portal_configuration_id: "bpc_intro",
      },
      discounts: [discount],
      items: {
        data: [
          {
            id: "si_intro",
            quantity: 1,
            price: base.price,
            current_period_end: Date.parse("2026-11-12T12:00:00Z") / 1000,
            discounts: [],
          },
        ],
      },
    };
    const stripe = {
      ...base.stripe,
      subscriptions: {
        retrieve: jest.fn(async () => subscription),
        list: jest.fn(async () => ({ data: [subscription], has_more: false })),
      },
      customers: {
        ...base.stripe.customers,
        retrieve: jest.fn(async () => ({
          id: "cus_intro",
          metadata: { discord_id: "payer" },
        })),
      },
      billingPortal: {
        ...base.stripe.billingPortal,
        sessions: {
          create: jest.fn(async () => ({
            url: "https://billing.stripe.com/manage",
          })),
        },
      },
    };
    getMockStore().subscriptions.set(base.request.guildId, {
      guildId: base.request.guildId,
      subscriptionType: "stripe",
      tier: "basic",
      status: "active",
      stripeCustomerId: "cus_intro",
      stripeSubscriptionId: "sub_intro",
      startDate: "2026-10-12T12:00:00Z",
    });
    return {
      ...base,
      discount,
      subscription,
      stripe,
      request: { ...base.request, stripe: stripe as unknown as StripeClient },
    };
  }
  beforeEach(() => {
    resetMockStore();
    clearGuildSubscriptionCache();
    jest.useFakeTimers({ now });
    Object.assign(config.stripe.basicIntroOffer, settings);
    config.stripe.subscriptionTransitionsEnabled = true;
  });
  afterEach(() => {
    jest.useRealTimers();
    config.stripe.subscriptionTransitionsEnabled = false;
    clearGuildSubscriptionCache();
  });

  test("an expected introductory offer cannot silently become an existing plan confirmation", async () => {
    const { request, stripe, subscription } = subscriberFixture();
    subscription.discounts = [];
    await expect(
      createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
    ).rejects.toThrow("changed");
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("expanded provider customer works when the local customer pointer is absent", async () => {
    const { request, stripe, subscription } = subscriberFixture();
    const pointer = getMockStore().subscriptions.get(request.guildId)!;
    delete pointer.stripeCustomerId;
    Object.assign(subscription, { customer: { id: "cus_intro" } });
    await expect(createPortalSession(request)).resolves.toContain(
      "billing.stripe.com",
    );
    expect(stripe.customers.retrieve).toHaveBeenCalledWith("cus_intro");
  });

  test("snapshot uses actual native price, discount and renewal", async () => {
    const { request } = subscriberFixture();
    const result = await getBillingSnapshot({
      stripe: request.stripe,
      guildId: request.guildId,
      payerId: "payer",
    });
    expect(result.introOffer).toEqual({ status: "ineligible" });
    expect(result.subscriptionDetails).toMatchObject({
      status: "available",
      priceId: "price_basic",
      currency: "usd",
      unitAmount: 1000,
      discountedUnitAmount: 600,
      interval: "month",
      renewalAt: "2026-11-12T12:00:00.000Z",
      discount: {
        percentOff: 40,
        durationMonths: 3,
        endsAt: "2027-01-12T12:00:00.000Z",
        introductory: true,
      },
      planChangesRestricted: true,
    });
  });

  test.each(["disabled", "rotated"])(
    "%s enrollment retains subscriber details and safe management",
    async (change) => {
      const { request, stripe } = subscriberFixture();
      Object.assign(
        config.stripe.basicIntroOffer,
        change === "disabled"
          ? empty
          : {
              ...settings,
              couponId: "coupon_next",
              portalConfigurationId: "bpc_next",
            },
      );
      const result = await getBillingSnapshot({
        stripe: request.stripe,
        guildId: request.guildId,
      });
      expect(result.subscriptionDetails).toMatchObject({
        status: "available",
        discountedUnitAmount: 600,
        planChangesRestricted: true,
      });
      await createPortalSession(request);
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ configuration: "bpc_intro" }),
      );
    },
  );

  test.each(["price_pro", "price_annual"])(
    "active introductory discount cannot move to %s",
    async (priceId) => {
      const { request, stripe } = subscriberFixture();
      await expect(
        createCheckoutSession({ ...request, priceId }),
      ).rejects.toThrow("discount ends");
      expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    },
  );

  test("normal management returns at the actual discount end", async () => {
    const { request, stripe, discount } = subscriberFixture();
    jest.setSystemTime(discount.end * 1000);
    const snapshot = await getBillingSnapshot({
      stripe: request.stripe,
      guildId: request.guildId,
    });
    expect(snapshot.subscriptionDetails).toMatchObject({
      status: "available",
      discountedUnitAmount: null,
      discount: null,
      planChangesRestricted: false,
    });
    await createPortalSession(request);
    expect(
      stripe.billingPortal.sessions.create.mock.calls[0][0],
    ).not.toHaveProperty("configuration");
    await createCheckoutSession({ ...request, priceId: "price_pro" });
    expect(stripe.billingPortal.sessions.create.mock.calls[1][0]).toMatchObject(
      { flow_data: { type: "subscription_update_confirm" } },
    );
  });

  test("provider detail failure is unavailable, never a fabricated regular price", async () => {
    const { request, stripe } = subscriberFixture();
    stripe.subscriptions.retrieve.mockRejectedValue(
      new Error("provider unavailable"),
    );
    const result = await getBillingSnapshot({
      stripe: request.stripe,
      guildId: request.guildId,
    });
    expect(result.subscriptionDetails).toEqual({ status: "unavailable" });
    await expect(createPortalSession(request)).rejects.toThrow();
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("shared billing customer cannot bypass an active intro discount through a regular guild", async () => {
    const { request, stripe, subscription, discount } = subscriberFixture();
    const otherSubscription = {
      ...subscription,
      id: "sub_other_intro",
      metadata: { ...subscription.metadata, guild_id: "222222222222222222" },
      discounts: [discount],
    };
    subscription.discounts = [];
    stripe.subscriptions.list.mockResolvedValue({
      data: [subscription, otherSubscription],
      has_more: false,
    });
    const snapshot = await getBillingSnapshot({
      stripe: request.stripe,
      guildId: request.guildId,
    });
    expect(snapshot.subscriptionDetails).toMatchObject({
      status: "available",
      discount: null,
      discountedUnitAmount: null,
      planChangesRestricted: true,
      planChangeRestrictionEndsAt: "2027-01-12T12:00:00.000Z",
    });
    expect(JSON.stringify(snapshot.subscriptionDetails)).not.toContain(
      "222222222222222222",
    );
    await createPortalSession(request);
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: "bpc_intro" }),
    );
    await expect(
      createCheckoutSession({ ...request, priceId: "price_pro" }),
    ).rejects.toThrow("discount");
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    jest.setSystemTime(discount.end * 1000);
    await createCheckoutSession({ ...request, priceId: "price_pro" });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(2);
  });

  test("portal restriction scans every provider customer page", async () => {
    const { request, stripe, subscription, discount } = subscriberFixture();
    const otherSubscription = {
      ...subscription,
      id: "sub_other_intro",
      metadata: { ...subscription.metadata, guild_id: "222222222222222222" },
      discounts: [discount],
    };
    subscription.discounts = [];
    stripe.subscriptions.list
      .mockResolvedValueOnce({ data: [subscription], has_more: true })
      .mockResolvedValueOnce({ data: [otherSubscription], has_more: false });
    await createPortalSession(request);
    expect(stripe.subscriptions.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customer: "cus_intro",
        starting_after: "sub_intro",
      }),
    );
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: "bpc_intro" }),
    );
  });

  test("unknown shared-customer restriction never creates an unrestricted portal", async () => {
    const { request, stripe } = subscriberFixture();
    stripe.subscriptions.list.mockRejectedValue(
      new Error("provider unavailable"),
    );
    await expect(createPortalSession(request)).rejects.toThrow();
    await expect(
      createCheckoutSession({ ...request, priceId: "price_pro" }),
    ).rejects.toThrow();
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test.each(["invalid", "deleted", "retrieval_failed"])(
    "applied coupon %s retains actual term and safe management",
    async (lifecycle) => {
      const { request, stripe, coupon, discount } = subscriberFixture();
      if (lifecycle === "invalid") coupon.valid = false;
      else if (lifecycle === "deleted")
        Object.assign(discount.source, {
          coupon: { id: "coupon_intro", object: "coupon", deleted: true },
        });
      else {
        Object.assign(discount.source, { coupon: "coupon_intro" });
        stripe.coupons.retrieve.mockRejectedValue(
          new Error("coupon details unavailable"),
        );
      }
      const result = await getBillingSnapshot({
        stripe: request.stripe,
        guildId: request.guildId,
      });
      if (lifecycle === "invalid")
        expect(result.subscriptionDetails).toMatchObject({
          status: "available",
          discount: { endsAt: "2027-01-12T12:00:00.000Z", introductory: true },
          planChangesRestricted: true,
          planChangeRestrictionEndsAt: "2027-01-12T12:00:00.000Z",
        });
      else
        expect(result.subscriptionDetails).toEqual({ status: "unavailable" });
      await createPortalSession(request);
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ configuration: "bpc_intro" }),
      );
      await expect(
        createCheckoutSession({ ...request, priceId: "price_pro" }),
      ).rejects.toThrow("discount ends");
      expect(discount.end).toBe(Date.parse("2027-01-12T12:00:00Z") / 1000);
    },
  );

  test("unsafe remaining-term portal never falls back to default management", async () => {
    const { request, stripe, portal } = subscriberFixture();
    portal.features.subscription_update.enabled = true;
    await expect(createPortalSession(request)).rejects.toThrow("configuration");
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe("remaining offer boundary cases", () => {
  beforeEach(() => {
    resetMockStore();
    clearGuildSubscriptionCache();
    jest.useFakeTimers({ now });
    Object.assign(config.stripe.basicIntroOffer, settings);
  });
  afterEach(() => {
    jest.useRealTimers();
    clearGuildSubscriptionCache();
  });

  test.each([
    { lookup_key: "pro_monthly" },
    { transform_quantity: { divide_by: 2, round: "up" } },
  ])("native Price mismatch %p cannot qualify", async (change) => {
    const { price, client } = fixture();
    Object.assign(price, change);
    await expect(
      getBasicIntroOffer({ stripe: client, plans }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  test("non-ISO dates do not activate an offer", async () => {
    config.stripe.basicIntroOffer.startsAt = "October 1, 2026";
    await expect(
      getBasicIntroOffer({ stripe: fixture().client, plans }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  test("provider validation crossing cutoff cannot authorize a new coupon reservation", async () => {
    const { stripe, client } = fixture();
    stripe.prices.retrieve.mockImplementation(async () => {
      jest.setSystemTime(Date.parse(settings.enrollmentEndsAt));
      return fixture().price;
    });
    await expect(
      getBasicIntroOffer({ stripe: client, plans }),
    ).resolves.toEqual({ status: "expired" });
  });

  test("shared caller resolves its manual promotion instead of silently losing it", async () => {
    const { request } = purchaseFixture();
    await createCheckoutSession({
      ...request,
      promotionCode: "OTHER",
      offerChoice: "promotion",
      expectedOffer: "none",
    });
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout.discounts,
    ).toEqual([{ promotion_code: "promo_other" }]);
  });

  test("unavailable sale cannot block an actual Pro price mislabeled by a caller", async () => {
    const { request, coupon } = purchaseFixture();
    coupon.percent_off = 39;
    await createCheckoutSession({
      ...request,
      priceId: "price_pro",
      tier: "basic",
      interval: "month",
    });
    expect(
      getMockStore().purchaseAttempts.get(request.guildId)?.checkout.discounts,
    ).toBeUndefined();
  });

  test("matching reservation remains available to its payer after the enrollment off-switch", async () => {
    const { request } = purchaseFixture();
    await createCheckoutSession(request);
    Object.assign(config.stripe.basicIntroOffer, empty);
    await expect(
      getGuildBasicIntroOffer({
        stripe: request.stripe,
        guildId: request.guildId,
        payerId: "payer",
      }),
    ).resolves.toMatchObject({ status: "available", id: "basic_intro_v1" });
    await expect(
      getGuildBasicIntroOffer({
        stripe: request.stripe,
        guildId: request.guildId,
        payerId: "other",
      }),
    ).resolves.toEqual({ status: "ineligible" });
  });
});

test("an entitlement read crossing cutoff cannot create a new introductory reservation", async () => {
  resetMockStore();
  clearGuildSubscriptionCache();
  jest.useFakeTimers({ now });
  Object.assign(config.stripe.basicIntroOffer, settings);
  const eligible = jest
    .spyOn(entitlementService, "getBestActiveEntitlementGrantForGuild")
    .mockImplementationOnce(async () => {
      jest.setSystemTime(Date.parse(settings.enrollmentEndsAt));
      return null;
    });
  try {
    const { request } = purchaseFixture();
    await expect(
      createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
    ).rejects.toThrow("changed");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
  } finally {
    eligible.mockRestore();
    jest.useRealTimers();
  }
});

describe("configured-offer price classification failures", () => {
  const originalFallback = config.stripe.priceBasic;
  beforeEach(() => {
    resetMockStore();
    clearGuildSubscriptionCache();
    jest.useFakeTimers({ now });
    Object.assign(config.stripe.basicIntroOffer, settings);
    config.stripe.priceBasic = "";
  });
  afterEach(() => {
    jest.useRealTimers();
    config.stripe.priceBasic = originalFallback;
    clearGuildSubscriptionCache();
  });

  test("priceId-only Basic caller cannot lose its offer during catalog failure", async () => {
    const { request, stripe } = purchaseFixture();
    stripe.prices.list.mockRejectedValue(new Error("catalog unavailable"));
    await expect(createCheckoutSession(request)).rejects.toThrow("unavailable");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test("Pro-only catalog cannot let an actual Basic price fall through at regular price", async () => {
    const { request, stripe, price } = purchaseFixture();
    stripe.prices.list.mockResolvedValue({
      data: [
        {
          ...price,
          id: "price_pro",
          lookup_key: config.stripe.lookupKeys.proMonthly,
        },
      ],
    });
    await expect(
      createCheckoutSession({ ...request, tier: "basic", interval: "month" }),
    ).rejects.toThrow("unavailable");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test.each([
    ["price_pro", "proMonthly", "month"],
    ["price_basic_annual", "basicAnnual", "year"],
    ["price_pro_annual", "proAnnual", "year"],
  ] as const)(
    "native %s remains purchasable during catalog failure",
    async (priceId, lookup, interval) => {
      const { request, stripe, price } = purchaseFixture();
      stripe.prices.list.mockRejectedValue(new Error("catalog unavailable"));
      Object.assign(price, {
        id: priceId,
        lookup_key: config.stripe.lookupKeys[lookup],
        recurring: { interval, interval_count: 1, usage_type: "licensed" },
      });
      await createCheckoutSession({
        ...request,
        priceId,
        tier: "basic",
        interval: "month",
      });
      expect(
        getMockStore().purchaseAttempts.get(request.guildId)?.checkout
          .discounts,
      ).toBeUndefined();
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    },
  );

  test("ambiguous Basic and Pro lookup configuration cannot authorize regular-price fallback", async () => {
    const previous = config.stripe.lookupKeys.proMonthly;
    config.stripe.lookupKeys.proMonthly = config.stripe.lookupKeys.basicMonthly;
    try {
      const { request, stripe } = purchaseFixture();
      stripe.prices.list.mockRejectedValue(new Error("catalog unavailable"));
      await expect(createCheckoutSession(request)).rejects.toThrow(
        "unavailable",
      );
      expect(getMockStore().purchaseAttempts.size).toBe(0);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      config.stripe.lookupKeys.proMonthly = previous;
    }
  });

  test("unclassifiable selected native price fails closed during catalog failure", async () => {
    const { request, stripe } = purchaseFixture();
    stripe.prices.list.mockRejectedValue(new Error("catalog unavailable"));
    stripe.prices.retrieve.mockRejectedValue(new Error("price unavailable"));
    await expect(createCheckoutSession(request)).rejects.toThrow("unavailable");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("open-ended introductory enrollment", () => {
  beforeEach(() => {
    resetMockStore();
    clearGuildSubscriptionCache();
    jest.useFakeTimers({ now });
    Object.assign(config.stripe.basicIntroOffer, settings, {
      enrollmentEndsAt: "",
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    clearGuildSubscriptionCache();
  });
  function openFixture() {
    const value = purchaseFixture();
    value.coupon.redeem_by = null;
    return value;
  }

  test("no enrollment end means a verified open-ended offer, with a three-month individual term", async () => {
    const { request } = openFixture();
    await expect(
      getBasicIntroOffer({ stripe: request.stripe, plans }),
    ).resolves.toMatchObject({
      status: "available",
      enrollmentEndsAt: null,
      durationMonths: 3,
      percentOff: 40,
    });
    jest.setSystemTime(Date.parse("2030-01-01T00:00:00Z"));
    await expect(
      getBasicIntroOffer({ stripe: request.stripe, plans }),
    ).resolves.toMatchObject({
      status: "available",
      enrollmentEndsAt: null,
      durationMonths: 3,
    });
  });

  test("a finite provider redemption deadline is unsafe for open-ended enrollment", async () => {
    const { request, coupon, stripe } = openFixture();
    coupon.redeem_by = Date.parse(settings.enrollmentEndsAt) / 1000 + 3600;
    await expect(
      getBasicIntroOffer({ stripe: request.stripe, plans }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(createCheckoutSession(request)).rejects.toThrow("unavailable");
    expect(getMockStore().purchaseAttempts.size).toBe(0);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test.each(["disabled", "ended"])(
    "deliberately %s enrollment preserves frozen attempts and refuses a fresh coupon",
    async (decision) => {
      const { request, stripe } = openFixture();
      stripe.checkout.sessions.create.mockRejectedValueOnce(
        new Error("lost response"),
      );
      await expect(
        createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
      ).rejects.toThrow("lost response");
      const frozen = structuredClone(
        getMockStore().purchaseAttempts.get(request.guildId)?.checkout,
      );
      expect(frozen?.discounts).toEqual([{ coupon: "coupon_intro" }]);
      expect(frozen?.metadata).not.toHaveProperty(
        "intro_offer_enrollment_ends_at",
      );
      expect(frozen?.subscription_data?.metadata).not.toHaveProperty(
        "intro_offer_enrollment_ends_at",
      );
      if (decision === "disabled")
        Object.assign(config.stripe.basicIntroOffer, empty);
      else
        config.stripe.basicIntroOffer.enrollmentEndsAt = new Date(
          now,
        ).toISOString();
      await expect(
        getGuildBasicIntroOffer({
          stripe: request.stripe,
          guildId: request.guildId,
          payerId: "payer",
        }),
      ).resolves.toMatchObject({ status: "available", enrollmentEndsAt: null });
      await expect(
        createCheckoutSession({ ...request, expectedOffer: "basic_intro_v1" }),
      ).resolves.toContain("checkout.stripe.com");
      expect(
        getMockStore().purchaseAttempts.get(request.guildId)?.checkout,
      ).toEqual(frozen);
      expect(stripe.checkout.sessions.create.mock.calls[1]).toEqual(
        stripe.checkout.sessions.create.mock.calls[0],
      );
      await expect(
        createCheckoutSession({
          ...request,
          guildId: "222222222222222222",
          expectedOffer: "basic_intro_v1",
        }),
      ).rejects.toThrow("changed");
      expect(getMockStore().purchaseAttempts.has("222222222222222222")).toBe(
        false,
      );
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    },
  );
});
