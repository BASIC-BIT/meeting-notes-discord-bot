export type PaidTier = "basic" | "pro";
export type BillingInterval = "month" | "year";

export type PaidPlan = {
  tier: PaidTier;
  interval: BillingInterval;
  priceId: string;
  unitAmount: number;
  currency: string;
  lookupKey?: string | null;
  productName?: string | null;
};
export type BasicIntroOffer =
  | { status: "inactive" | "ineligible" | "expired" | "unavailable" }
  | {
      status: "available";
      id: "basic_intro_v1";
      priceId: string;
      currency: "usd";
      regularUnitAmount: 1000;
      discountedUnitAmount: 600;
      percentOff: 40;
      durationMonths: 3;
      enrollmentEndsAt: string;
    };
export type ExpectedIntroOffer = "none" | "basic_intro_v1";
export type IntroOfferChoice = "automatic" | "promotion";
export type ProviderSubscriptionDetails =
  | { status: "unavailable" }
  | {
      status: "available";
      priceId: string;
      currency: string;
      unitAmount: number;
      discountedUnitAmount: number | null;
      interval: BillingInterval;
      renewalAt: string | null;
      cancelAtPeriodEnd: boolean;
      discount: {
        percentOff: number | null;
        amountOff: number | null;
        durationMonths: number | null;
        endsAt: string | null;
        introductory: boolean;
      } | null;
      planChangesRestricted: boolean;
      planChangeRestrictionEndsAt: string | null;
    };
