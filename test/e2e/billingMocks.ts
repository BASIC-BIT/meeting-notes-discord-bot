import type { Page } from "@playwright/test";
import type {
  BasicIntroOffer,
  ProviderSubscriptionDetails,
} from "../../src/types/pricing";
import {
  introPlans,
  monthlyIntroOffer,
  annualIntroOffer,
} from "../../src/frontend/pages/basicIntroFixtures";

type IntroBillingOptions = {
  status?: BasicIntroOffer["status"];
  details?: ProviderSubscriptionDetails;
  legacy?: boolean;
  terminalStatus?: "canceled" | "incomplete_expired";
};

function introBillingData(options: IntroBillingOptions) {
  return {
    tier: options.details ? "basic" : "free",
    billingSource: options.details || options.legacy ? "stripe" : "free",
    status: options.terminalStatus
      ? options.terminalStatus
      : options.details
        ? "active"
        : "free",
    billingEnabled: true,
    hasStripeBilling: Boolean(
      options.details || options.legacy || options.terminalStatus,
    ),
    canManageBillingPortal: Boolean(
      options.details || options.legacy || options.terminalStatus,
    ),
    usage: options.terminalStatus
      ? {
          usedMinutes: 45,
          limitMinutes: 240,
          remainingMinutes: 195,
        }
      : null,
    subscriptionDetails: options.details,
  };
}

export async function useIntroBilling(
  page: Page,
  options: IntroBillingOptions = {},
) {
  await page.route("**/trpc/**", async (route) => {
    const status = options.status ?? "available";
    const paths = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/trpc/")[1],
    ).split(",");
    if (
      !paths.some((path) => path === "billing.me" || path === "pricing.plans")
    )
      return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const entries = Array.isArray(body) ? body : [body];
    const offers = {
      introOffer: status === "available" ? monthlyIntroOffer : { status },
      annualIntroOffer: status === "available" ? annualIntroOffer : { status },
    };
    const next = entries.map((entry, index) =>
      paths[index] === "pricing.plans"
        ? { result: { data: { plans: introPlans, ...offers } } }
        : paths[index] === "billing.me"
          ? {
              result: {
                data: {
                  ...introBillingData(options),
                  ...offers,
                },
              },
            }
          : entry,
    );
    await route.fulfill({
      response,
      json: Array.isArray(body) ? next : next[0],
    });
  });
}

// Keep provider state out of UI purchase tests; the real mock runtime forces Pro.
export async function useFreeBilling(
  page: Page,
  {
    terminalStatus,
    grantTier,
  }: {
    terminalStatus?: "canceled" | "incomplete_expired";
    grantTier?: "basic" | "pro";
  } = {},
) {
  const limitMinutes =
    grantTier === "pro" ? null : grantTier === "basic" ? 1200 : 240;
  const usage = terminalStatus
    ? {
        usedMinutes: 45,
        limitMinutes,
        remainingMinutes: limitMinutes === null ? null : limitMinutes - 45,
      }
    : null;
  await page.route("**/trpc/**", async (route) => {
    const paths = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/trpc/")[1],
    ).split(",");
    if (!paths.includes("billing.me")) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const entries = Array.isArray(body) ? body : [body];
    const next = entries.map((entry, index) =>
      paths[index] === "billing.me"
        ? {
            result: {
              data: {
                tier: grantTier ?? "free",
                billingSource: grantTier ? "manual_comp" : "free",
                grantTier: grantTier ?? null,
                status: grantTier ? "comped" : (terminalStatus ?? "free"),
                stripeStatus: terminalStatus ?? null,
                billingEnabled: true,
                hasStripeBilling: Boolean(terminalStatus),
                canManageBillingPortal: Boolean(terminalStatus),
                usage,
              },
            },
          }
        : entry,
    );
    await route.fulfill({
      response,
      json: Array.isArray(body) ? next : next[0],
    });
  });
}
