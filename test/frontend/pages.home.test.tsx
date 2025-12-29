import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { screen } from "@testing-library/react";
import type { PaidPlan } from "../../src/types/pricing";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { setPricingQuery } from "./mocks/trpc";
import Home from "../../src/frontend/pages/Home";

describe("Home page", () => {
  beforeEach(() => {
    resetFrontendMocks();
  });

  test("renders pricing unavailable when plans are missing", () => {
    setPricingQuery({ data: { plans: [] } });
    renderWithMantine(<Home />);
    const unavailable = screen.getAllByText("Pricing unavailable");
    expect(unavailable.length).toBeGreaterThan(0);
  });

  test("renders monthly pricing when annual plans exist", () => {
    const plans: PaidPlan[] = [
      {
        tier: "basic",
        interval: "month",
        priceId: "price_basic_month",
        unitAmount: 2000,
        currency: "usd",
      },
      {
        tier: "basic",
        interval: "year",
        priceId: "price_basic_year",
        unitAmount: 20000,
        currency: "usd",
      },
      {
        tier: "pro",
        interval: "month",
        priceId: "price_pro_month",
        unitAmount: 4000,
        currency: "usd",
      },
    ];
    setPricingQuery({ data: { plans } });
    renderWithMantine(<Home />);
    expect(screen.getByText("$20 / mo")).toBeInTheDocument();
    expect(screen.getByText("$40 / mo")).toBeInTheDocument();
    expect(screen.queryByText("Pricing unavailable")).toBeNull();
  });
});
