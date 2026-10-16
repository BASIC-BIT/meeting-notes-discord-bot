import "./mocks/mockFrontendContexts";
import "./mocks/mockRouter";
import "./mocks/trpc";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { beforeEach, expect, it } from "@jest/globals";
import { act } from "@testing-library/react";
import Billing from "../../src/frontend/pages/Billing";
import {
  annualIntroOffer,
  introPlans,
} from "../../src/frontend/pages/basicIntroFixtures";
import {
  authState,
  guildState,
  renderWithMantine,
  resetFrontendMocks,
  setRouteParams,
  setRouteSearch,
  navigateSpy,
} from "./testUtils";
import {
  billingChangePrepare,
  billingChangeQuery,
  billingRenewalQuery,
  setBillingQuery,
  setPricingQuery,
} from "./mocks/trpc";
beforeEach(resetFrontendMocks);
it("keeps the direct annual selection until pricing can identify its offer", async () => {
  authState.state = "authenticated";
  guildState.selectedGuildId = "g1";
  guildState.guilds = [{ id: "g1", name: "Guild One", canManage: true }];
  setRouteParams({ serverId: "g1" });
  setRouteSearch({ plan: "basic", interval: "year" });
  setBillingQuery({
    data: {
      billingEnabled: true,
      tier: "pro",
      status: "active",
      billingSource: "stripe",
      hasStripeBilling: true,
      canManageBillingPortal: true,
      annualIntroOffer,
    },
  });
  billingRenewalQuery.data = {
    state: { kind: "not_applicable" },
    canManageBilling: true,
    lifecycleAnalyticsEnabled: false,
  };
  billingChangeQuery.data = { kind: "none", enabled: true };
  setPricingQuery({ data: { plans: [] }, isFetching: true, isLoading: true });
  const { rerender } = renderWithMantine(<Billing />);
  expect(billingChangePrepare.mutateAsync).not.toHaveBeenCalled();
  expect(navigateSpy).not.toHaveBeenCalled();
  setPricingQuery({
    data: { plans: introPlans, annualIntroOffer },
    isFetching: false,
    isLoading: false,
  });
  await act(async () => {
    rerender(
      <MantineProvider>
        <Billing />
      </MantineProvider>,
    );
  });
  expect(billingChangePrepare.mutateAsync).toHaveBeenCalledWith({
    serverId: "g1",
    selection: {
      tier: "basic",
      interval: "year",
      expectedOffer: "basic_annual_intro_v1",
    },
  });
});
