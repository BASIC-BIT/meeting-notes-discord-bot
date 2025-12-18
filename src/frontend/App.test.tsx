import React from "react";
import { render, waitFor } from "@testing-library/react";
import App from "./App";
import { MantineProvider } from "@mantine/core";

// Basic fetch mock for guilds + billing
global.fetch = jest.fn((input: RequestInfo) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.startsWith("/api/guilds")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ guilds: [{ id: "1", name: "Test Guild" }] }),
    }) as unknown as Response;
  }
  if (url.startsWith("/api/billing/me")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        billingEnabled: false,
        stripeMode: "disabled",
        tier: "free",
        status: "free",
        nextBillingDate: null,
        subscriptionId: null,
        customerId: null,
        upgradeUrl: null,
        portalUrl: null,
      }),
    }) as unknown as Response;
  }
  if (url.startsWith("/user")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    }) as unknown as Response;
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({}),
  }) as unknown as Response;
}) as unknown as typeof fetch;

test("renders app shell without crashing", async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MantineProvider>{children}</MantineProvider>
  );

  try {
    render(<App />, { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    throw err;
  }
});
