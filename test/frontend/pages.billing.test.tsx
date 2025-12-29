import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { screen, within } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { guildState } from "./testUtils";
import { setBillingQuery, setPricingQuery } from "./mocks/trpc";
import Billing from "../../src/frontend/pages/Billing";

describe("Billing page", () => {
  beforeEach(() => {
    resetFrontendMocks();
    setPricingQuery({ data: { plans: [] } });
  });

  test("renders no server state when nothing is selected", () => {
    guildState.selectedGuildId = null;
    setBillingQuery({ data: null, isLoading: false, error: null });
    renderWithMantine(<Billing />);
    expect(
      screen.getByText(/Select a server to view billing/i),
    ).toBeInTheDocument();
  });

  test("renders disabled billing state", () => {
    guildState.selectedGuildId = "g1";
    guildState.guilds = [{ id: "g1", name: "Guild One" }];
    setBillingQuery({
      data: {
        billingEnabled: false,
        tier: "free",
        status: "disabled",
        nextBillingDate: null,
        usage: null,
      },
    });
    renderWithMantine(<Billing />);
    expect(screen.getByText(/Billing disabled/i)).toBeInTheDocument();
  });

  test("renders paid plan status line", () => {
    guildState.selectedGuildId = "g1";
    guildState.guilds = [{ id: "g1", name: "Guild One" }];
    setBillingQuery({
      data: {
        billingEnabled: true,
        tier: "pro",
        status: "active",
        nextBillingDate: "2025-12-31T00:00:00.000Z",
        usage: { usedMinutes: 30, limitMinutes: 60 },
      },
    });
    renderWithMantine(<Billing />);
    const currentPanel = screen.getByTestId("billing-current-plan");
    expect(within(currentPanel).getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText(/next billing/i)).toBeInTheDocument();
  });
});
