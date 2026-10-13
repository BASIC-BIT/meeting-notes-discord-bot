import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import SubscriptionDetails from "./SubscriptionDetails";
import type { ProviderSubscriptionDetails } from "../../types/pricing";

const annual: ProviderSubscriptionDetails = {
  status: "available",
  priceId: "basic-year",
  currency: "usd",
  unitAmount: 10000,
  discountedUnitAmount: null,
  interval: "year",
  renewalAt: "2027-10-12T12:00:00Z",
  cancelAtPeriodEnd: false,
  discount: null,
  planChangesRestricted: false,
  planChangeRestrictionEndsAt: null,
  firstYearPayment: {
    status: "available",
    currency: "usd",
    discountedSubtotal: 6000,
    amountPaid: 6420,
    periodStartsAt: "2026-10-12T12:00:00Z",
    periodEndsAt: "2027-10-12T12:00:00Z",
  },
};
const show = (details: ProviderSubscriptionDetails) =>
  render(
    <MantineProvider>
      <SubscriptionDetails details={details} />
    </MantineProvider>,
  );
it("separates verified first-year payment including tax from annual renewal", () => {
  show(annual);
  expect(screen.getByText(/First year paid: \$64.20/)).toBeVisible();
  expect(screen.getByText(/First-year subtotal: \$60/)).toBeVisible();
  expect(screen.getByText(/Next renewal: \$100\/year/)).toBeVisible();
  expect(screen.queryByText(/restricted/)).not.toBeInTheDocument();
});
it("does not invent paid first-year price when invoice evidence is unavailable", () => {
  show({ ...annual, firstYearPayment: { status: "unavailable" } });
  expect(
    screen.getByText(/First-year payment details are unavailable/),
  ).toBeVisible();
  expect(screen.queryByText(/\$60/)).not.toBeInTheDocument();
});
it("shows actual monthly discount and account restriction without inventing an end", () => {
  show({
    ...annual,
    interval: "month",
    unitAmount: 1000,
    discountedUnitAmount: 600,
    firstYearPayment: null,
    planChangesRestricted: true,
    planChangeRestrictionEndsAt: null,
    discount: {
      introductory: true,
      endsAt: null,
      durationMonths: 3,
      percentOff: 40,
      amountOff: null,
    },
  });
  expect(screen.getByText(/Current price: \$6\/month/)).toBeVisible();
  expect(
    screen.getByText(/Account-wide plan changes are temporarily restricted/),
  ).toBeVisible();
  expect(
    screen.getByText(/The provider has not supplied the restriction end/),
  ).toBeVisible();
});
it("keeps cancellation honest and does not call it a renewal", () => {
  show({ ...annual, cancelAtPeriodEnd: true });
  expect(screen.getByText(/Cancels on/)).toBeVisible();
  expect(screen.queryByText(/Next renewal/)).not.toBeInTheDocument();
});
