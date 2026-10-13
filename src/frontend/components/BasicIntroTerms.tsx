import { Stack, Text } from "@mantine/core";
import type { BasicIntroOffer } from "../../types/pricing";
import { introOfferTerms } from "../utils/pricing";

export default function BasicIntroTerms({
  offer,
  conditional = false,
}: {
  offer: BasicIntroOffer;
  conditional?: boolean;
}) {
  if (offer.status !== "available") return null;
  return (
    <Stack gap={4} mt="sm" data-testid="basic-intro-terms">
      <Text size="sm" fw={600} c="var(--mantine-color-text)">
        {introOfferTerms(offer)}
      </Text>
      <Text size="xs" c="var(--mantine-color-text)">
        {conditional
          ? "For eligible servers starting their first paid subscription. "
          : "For this server's first paid subscription. "}
        Basic only. Cannot be combined with another promotion.{" "}
        {offer.id === "basic_annual_intro_v1"
          ? "Billed yearly, with the first year paid upfront."
          : "Billed monthly."}{" "}
        Renews automatically unless canceled. Tax may apply.
      </Text>
      <Text size="xs" c="var(--mantine-color-text)">
        {offer.id === "basic_annual_intro_v1"
          ? "While the first-invoice discount is active, plan and billing-period changes are restricted across all subscriptions on your billing account. Once the first invoice is finalized, this annual offer does not restrict plan changes for the rest of the year."
          : "During the 3-month discount, plan and billing-period changes are restricted across all subscriptions on your billing account."}{" "}
        Payment methods and cancellation remain available.
      </Text>
      {offer.enrollmentEndsAt ? (
        <Text size="xs" c="var(--mantine-color-text)">
          Enroll by {new Date(offer.enrollmentEndsAt).toLocaleDateString()}.
        </Text>
      ) : null}
    </Stack>
  );
}
