import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

type EnvSnapshot = NodeJS.ProcessEnv;

const snapshotEnv = (): EnvSnapshot => ({ ...process.env });

const setStripeEnv = () => {
  process.env.MOCK_MODE = "true";
  process.env.STRIPE_PRICE_BASIC = "price_basic_legacy";
  process.env.STRIPE_PRICE_LOOKUP_BASIC_MONTHLY = "chronote_basic_monthly";
  process.env.STRIPE_PRICE_LOOKUP_BASIC_ANNUAL = "chronote_basic_annual";
  process.env.STRIPE_PRICE_LOOKUP_PRO_MONTHLY = "chronote_pro_monthly";
  process.env.STRIPE_PRICE_LOOKUP_PRO_ANNUAL = "chronote_pro_annual";
};

const loadResolver = async () => {
  jest.resetModules();
  setStripeEnv();
  const module = await import("../../src/services/pricingService");
  return module.resolveTierFromPrice;
};

describe("resolveTierFromPrice", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it("prefers lookup key over legacy price id", async () => {
    const resolveTierFromPrice = await loadResolver();
    expect(
      resolveTierFromPrice({
        lookupKey: "chronote_pro_monthly",
        priceId: "price_basic_legacy",
      }),
    ).toBe("pro");
  });

  it("resolves basic from lookup key", async () => {
    const resolveTierFromPrice = await loadResolver();
    expect(
      resolveTierFromPrice({
        lookupKey: "chronote_basic_annual",
      }),
    ).toBe("basic");
  });

  it("falls back to legacy price id when lookup key is missing", async () => {
    const resolveTierFromPrice = await loadResolver();
    expect(
      resolveTierFromPrice({
        priceId: "price_basic_legacy",
      }),
    ).toBe("basic");
  });

  it("returns null when no match is found", async () => {
    const resolveTierFromPrice = await loadResolver();
    expect(
      resolveTierFromPrice({
        lookupKey: "unknown_key",
        priceId: "price_unknown",
      }),
    ).toBeNull();
  });
});
