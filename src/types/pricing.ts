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
