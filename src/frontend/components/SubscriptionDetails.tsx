import { Alert, Stack, Text } from "@mantine/core";
import type { ProviderSubscriptionDetails } from "../../types/pricing";
import { formatCurrency } from "../utils/pricing";

const date = (value: string) => new Date(value).toLocaleDateString();

type AvailableDetails = Extract<
  ProviderSubscriptionDetails,
  { status: "available" }
>;

function currentPeriodPayment({
  details,
  currentPrice,
  period,
}: {
  details: AvailableDetails;
  currentPrice: string;
  period: string;
}) {
  const firstYear = details.firstYearPayment;
  return (
    <>
      {firstYear?.status === "available" ? (
        <>
          <Text size="sm" c="var(--mantine-color-text)">
            First year paid:{" "}
            {formatCurrency(firstYear.amountPaid, firstYear.currency)},
            including any tax.
          </Text>
          <Text size="xs" c="var(--mantine-color-text)">
            First-year subtotal:{" "}
            {formatCurrency(firstYear.discountedSubtotal, firstYear.currency)}.
            Covers {date(firstYear.periodStartsAt)} to{" "}
            {date(firstYear.periodEndsAt)}.
          </Text>
        </>
      ) : firstYear?.status === "unavailable" ? (
        <Text size="sm" c="var(--mantine-color-text)">
          First-year payment details are unavailable. Review your invoice in
          Manage billing.
        </Text>
      ) : (
        <Text size="sm" c="var(--mantine-color-text)">
          Current price: {currentPrice}/{period}, before tax.
        </Text>
      )}
    </>
  );
}

function renewalLine(
  details: AvailableDetails,
  period: string,
  renewalPrice: string | null,
) {
  return details.cancelAtPeriodEnd
    ? details.renewalAt
      ? `Cancels on ${date(details.renewalAt)}. No automatic renewal.`
      : "Cancellation is scheduled. The provider has not supplied the end date."
    : details.renewalAt
      ? renewalPrice
        ? `Next renewal: ${renewalPrice}/${period} on ${date(details.renewalAt)}, before tax.`
        : `Next billing date: ${date(details.renewalAt)}. Renewal price is not yet confirmed by the provider.`
      : "The provider has not supplied the next renewal date.";
}

function renewalPriceFor(
  details: AvailableDetails,
  currentPrice: string,
  regularPrice: string,
) {
  return details.discount && !details.discount.endsAt
    ? null
    : details.discount?.endsAt &&
        details.renewalAt &&
        Date.parse(details.renewalAt) >= Date.parse(details.discount.endsAt)
      ? regularPrice
      : currentPrice;
}

export default function SubscriptionDetails({
  details,
}: {
  details: ProviderSubscriptionDetails | null | undefined;
}) {
  if (!details || details.status === "unavailable")
    return (
      <Text size="sm" c="var(--mantine-color-text)">
        Provider price and renewal details are unavailable. Review payment and
        cancellation in Manage billing.
      </Text>
    );
  const period = details.interval === "year" ? "year" : "month";
  const currentPrice = formatCurrency(
    details.discountedUnitAmount ?? details.unitAmount,
    details.currency,
  );
  const regularPrice = formatCurrency(details.unitAmount, details.currency);
  const renewalPrice = renewalPriceFor(details, currentPrice, regularPrice);
  return (
    <Stack gap="xs" data-testid="subscription-details">
      {currentPeriodPayment({ details, currentPrice, period })}
      {details.discount?.introductory ? (
        <Text size="sm" c="var(--mantine-color-text)">
          {details.discount.endsAt
            ? `Introductory discount ends ${date(details.discount.endsAt)}.`
            : "The provider has not supplied the introductory discount end."}{" "}
          Regular price: {regularPrice}/{period}, before tax.
        </Text>
      ) : null}
      <Text size="sm" c="var(--mantine-color-text)">
        {renewalLine(details, period, renewalPrice)}
      </Text>
      {details.planChangesRestricted ? (
        <Alert
          color="yellow"
          title="Account-wide plan changes are temporarily restricted"
        >
          An introductory discount on your billing account temporarily limits
          plan changes across its subscriptions. Payment methods and
          cancellation remain available.
          <Text size="sm" mt="xs" c="var(--mantine-color-text)">
            {details.planChangeRestrictionEndsAt
              ? `Restriction ends ${date(details.planChangeRestrictionEndsAt)}.`
              : "The provider has not supplied the restriction end."}
          </Text>
        </Alert>
      ) : null}
    </Stack>
  );
}
