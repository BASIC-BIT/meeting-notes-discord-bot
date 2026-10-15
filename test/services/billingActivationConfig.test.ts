/** @jest-environment node */
import { afterEach, expect, it, jest } from "@jest/globals";

jest.mock("dotenv", () => ({ config: jest.fn() }));
const original = process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED;
afterEach(() => {
  if (original === undefined)
    delete process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED;
  else process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED = original;
  jest.resetModules();
});

it.each([undefined, "false", "", "TRUE", "1", " true "])(
  "keeps hosted transitions disabled for %s",
  async (value) => {
    if (value === undefined)
      delete process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED;
    else process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED = value;
    jest.resetModules();
    const { config } = await import("../../src/services/configService");
    expect(config.stripe.subscriptionTransitionsEnabled).toBe(false);
  },
);

it("requires explicit true to activate hosted transitions", async () => {
  process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED = "true";
  jest.resetModules();
  const { config } = await import("../../src/services/configService");
  expect(config.stripe.subscriptionTransitionsEnabled).toBe(true);
});

const originalRenewal = process.env.STRIPE_RENEWAL_REACTIVATION_ENABLED;
afterEach(() => {
  if (originalRenewal === undefined)
    delete process.env.STRIPE_RENEWAL_REACTIVATION_ENABLED;
  else process.env.STRIPE_RENEWAL_REACTIVATION_ENABLED = originalRenewal;
});
it.each([undefined, "false", "", "TRUE", "1", " true "])(
  "keeps direct renewal disabled for %s",
  async (value) => {
    if (value === undefined)
      delete process.env.STRIPE_RENEWAL_REACTIVATION_ENABLED;
    else process.env.STRIPE_RENEWAL_REACTIVATION_ENABLED = value;
    jest.resetModules();
    const { config } = await import("../../src/services/configService");
    expect(config.stripe.renewalReactivationEnabled).toBe(false);
  },
);
it("enables renewal independently of hosted transitions", async () => {
  process.env.STRIPE_RENEWAL_REACTIVATION_ENABLED = "true";
  process.env.STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED = "false";
  jest.resetModules();
  const { config } = await import("../../src/services/configService");
  expect(config.stripe.renewalReactivationEnabled).toBe(true);
  expect(config.stripe.subscriptionTransitionsEnabled).toBe(false);
});
