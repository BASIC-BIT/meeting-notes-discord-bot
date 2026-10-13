import { Stack, Text } from "@mantine/core";
import type { BasicIntroOffer } from "../../types/pricing";
import { introOfferTerms } from "../utils/pricing";

export default function BasicIntroTerms({ offer }: { offer: BasicIntroOffer }) {
  if (offer.status !== "available") return null;
  return (
    <Stack gap={4} mt="sm" data-testid="basic-intro-terms">
      <Text size="sm" fw={600} c="var(--mantine-color-text)">
        {introOfferTerms(offer)}
      </Text>
      <Text size="xs" c="var(--mantine-color-text)">
        First paid subscription per server. Cannot combine with other offers.
        Auto-renews. Tax may apply.
      </Text>
      <Text size="xs" c="var(--mantine-color-text)">
        {offer.id === "basic_annual_intro_v1"
          ? "This offer pauses account-wide plan changes until the first invoice is finalized."
          : "This discount pauses account-wide plan changes for 3 months."}{" "}
        Payment methods and cancellation stay available.
      </Text>
      {offer.enrollmentEndsAt ? (
        <Text size="xs" c="var(--mantine-color-text)">
          Enroll by {new Date(offer.enrollmentEndsAt).toLocaleDateString()}.
        </Text>
      ) : null}
    </Stack>
  );
}
