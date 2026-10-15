/** @jest-environment node */
import { beforeEach, afterEach, it, expect, jest } from "@jest/globals";
import {
  captureEvent,
  shutdownAnalytics,
} from "../../src/services/analyticsService";
import { config } from "../../src/services/configService";
const mockCapture = jest.fn();
jest.mock("posthog-node", () => ({
  PostHog: jest.fn(() => ({
    capture: (...args: unknown[]) => mockCapture(...args),
    shutdown: async () => undefined,
  })),
}));
const original = config.analytics.posthogKey;
beforeEach(async () => {
  await shutdownAnalytics();
  mockCapture.mockReset();
  config.analytics.posthogKey = "";
});
afterEach(async () => {
  await shutdownAnalytics();
  config.analytics.posthogKey = original;
});
it("does not send without a key or usable identity", () => {
  captureEvent("example", { guildId: "fixture" });
  expect(mockCapture).not.toHaveBeenCalled();
  config.analytics.posthogKey = "phc_fixture";
  captureEvent("example");
  expect(mockCapture).not.toHaveBeenCalled();
});
it("uses the standard observation timestamp and namespaced guild identity without inventing an actor", () => {
  config.analytics.posthogKey = "phc_fixture";
  const timestamp = new Date("2026-10-14T12:00:00Z");
  captureEvent("billing_subscription_state_changed", {
    guildId: "fixture",
    timestamp,
    properties: { to_state: "ended" },
  });
  expect(mockCapture).toHaveBeenCalledWith(
    expect.objectContaining({
      distinctId: "guild:fixture",
      timestamp,
      properties: expect.objectContaining({
        guild_id: "fixture",
        to_state: "ended",
      }),
    }),
  );
});
it("never throws a client failure into billing", () => {
  config.analytics.posthogKey = "phc_fixture";
  mockCapture.mockImplementationOnce(() => {
    throw Error("outage");
  });
  expect(() => captureEvent("example", { guildId: "fixture" })).not.toThrow();
});
