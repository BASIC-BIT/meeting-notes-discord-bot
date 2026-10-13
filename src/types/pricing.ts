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
  | ({
      status: "available";
      priceId: string;
      currency: "usd";
      percentOff: 40;
      enrollmentEndsAt: string | null;
    } & (
      | {
          id: "basic_intro_v1";
          regularUnitAmount: 1000;
          discountedUnitAmount: 600;
          durationMonths: 3;
        }
      | {
          id: "basic_annual_intro_v1";
          regularUnitAmount: 10000;
          discountedUnitAmount: 6000;
          durationMonths: 12;
        }
    ));
export type ExpectedIntroOffer =
  "none" | "basic_intro_v1" | "basic_annual_intro_v1";
export type FirstYearPayment =
  | { status: "unavailable" }
  | {
      status: "available";
      currency: "usd";
      discountedSubtotal: 6000;
      amountPaid: number;
      periodStartsAt: string;
      periodEndsAt: string;
    };
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
      firstYearPayment: FirstYearPayment | null;
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
