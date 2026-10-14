import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../trpc/router";

type BillingHistory = Pick<
  inferRouterOutputs<AppRouter>["billing"]["me"],
  "tier" | "status" | "hasStripeBilling"
>;
export type TerminalSubscriptionStatus = "canceled" | "incomplete_expired";

export function isTerminalStripeHistory(data: BillingHistory): boolean {
  return (
    data.tier === "free" &&
    data.hasStripeBilling &&
    (data.status === "canceled" || data.status === "incomplete_expired")
  );
}
export function requiresStripeManagement(data: BillingHistory): boolean {
  return data.hasStripeBilling && !isTerminalStripeHistory(data);
}
