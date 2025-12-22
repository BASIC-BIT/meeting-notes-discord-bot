import Stripe from "stripe";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { getPaymentTransactionRepository } from "../repositories/paymentTransactionRepository";
import { config } from "./configService";
import { nowIso } from "../utils/time";
import type { GuildSubscription, PaymentTransaction } from "../types/db";

export type BillingSnapshot = {
  billingEnabled: boolean;
  stripeMode: string;
  tier: "free" | "basic" | "pro";
  status: string;
  nextBillingDate: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  upgradeUrl: string | null;
  portalUrl: string | null;
};

type StripeUser = {
  id: string;
  email?: string;
  username?: string;
};

export function buildBillingDisabledSnapshot(): BillingSnapshot {
  return {
    tier: "free",
    status: "free",
    nextBillingDate: null,
    subscriptionId: null,
    customerId: null,
    upgradeUrl: config.stripe.billingLandingUrl || null,
    portalUrl: null,
    billingEnabled: false,
    stripeMode: config.subscription.stripeMode || "disabled",
  };
}

export async function getBillingSnapshot(params: {
  stripe: Stripe | null;
  guildId: string;
  host: string;
  protocol: string;
}): Promise<BillingSnapshot> {
  const { stripe, guildId, host, protocol } = params;
  if (!stripe || !config.stripe.secretKey) {
    return buildBillingDisabledSnapshot();
  }

  const subscription = await getSubscriptionRepository().get(guildId);
  const status = subscription?.status || "free";
  const nextBillingDate = subscription?.nextBillingDate || null;
  const tier =
    (subscription?.tier as BillingSnapshot["tier"] | undefined) ??
    (status === "free" ? "free" : "basic");

  return {
    tier,
    status,
    nextBillingDate,
    subscriptionId: subscription?.stripeSubscriptionId || null,
    customerId: subscription?.stripeCustomerId || null,
    upgradeUrl: config.stripe.billingLandingUrl || null,
    portalUrl: `${protocol}://${host}/api/billing/portal?guildId=${guildId}`,
    billingEnabled: true,
    stripeMode: config.subscription.stripeMode || "live",
  };
}

export async function getMockBillingSnapshot(
  guildId: string,
): Promise<BillingSnapshot> {
  const subscription = await getSubscriptionRepository().get(guildId);
  const status = subscription?.status || "free";
  const tier =
    (subscription?.tier as BillingSnapshot["tier"] | undefined) ??
    (status === "free" ? "free" : "basic");
  return {
    tier,
    status,
    nextBillingDate: subscription?.nextBillingDate || null,
    subscriptionId: subscription?.stripeSubscriptionId || null,
    customerId: subscription?.stripeCustomerId || null,
    upgradeUrl: `/portal/server/${guildId}/billing?mock=checkout`,
    portalUrl: `/portal/server/${guildId}/billing?mock=portal`,
    billingEnabled: true,
    stripeMode: "mock",
  };
}

export async function seedMockSubscription(guildId: string) {
  const repo = getSubscriptionRepository();
  const existing = await repo.get(guildId);
  await repo.write({
    guildId,
    status: "active",
    tier: "basic",
    subscriptionType: "mock",
    startDate: existing?.startDate ?? nowIso(),
    nextBillingDate:
      existing?.nextBillingDate ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 25).toISOString(),
    stripeCustomerId: existing?.stripeCustomerId ?? "cus_mock_basic",
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? "sub_mock_basic",
    mode: "test",
  });
}

export async function saveGuildSubscription(subscription: GuildSubscription) {
  await getSubscriptionRepository().write(subscription);
}

export async function recordPaymentTransaction(
  transaction: PaymentTransaction,
) {
  await getPaymentTransactionRepository().write(transaction);
}

export async function ensureStripeCustomer(
  stripe: Stripe,
  user: StripeUser,
): Promise<string> {
  const searchEmail = user.email;
  if (searchEmail) {
    const found = await stripe.customers.list({
      email: searchEmail,
      limit: 1,
    });
    if (found.data.length) return found.data[0].id;
  }
  const created = await stripe.customers.create({
    ...(searchEmail ? { email: searchEmail } : {}),
    metadata: {
      discord_id: user.id,
      discord_username: user.username ?? "",
    },
  });
  return created.id;
}

export async function createCheckoutSession(params: {
  stripe: Stripe;
  user: StripeUser;
  guildId: string;
}): Promise<string> {
  const { stripe, user, guildId } = params;
  if (!config.stripe.priceBasic?.startsWith("price_")) {
    throw new Error("Stripe price not configured");
  }
  const customerId = await ensureStripeCustomer(stripe, user);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: config.stripe.priceBasic, quantity: 1 }],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    customer: customerId,
    client_reference_id: user.id,
    metadata: {
      discord_id: user.id,
      discord_username: user.username ?? "",
      guild_id: guildId,
    },
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return session.url;
}

export async function createPortalSession(params: {
  stripe: Stripe;
  user: StripeUser;
  guildId: string;
}): Promise<string> {
  const { stripe, user, guildId } = params;
  const subscription = await getSubscriptionRepository().get(guildId);
  let customerId =
    subscription?.stripeCustomerId ||
    (typeof subscription?.stripeSubscriptionId === "string"
      ? (
          await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
        ).customer?.toString()
      : undefined);
  if (!customerId) {
    customerId = await ensureStripeCustomer(stripe, user);
  }
  if (!customerId) {
    throw new Error("No Stripe customer found for guild");
  }
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: config.stripe.portalReturnUrl || config.stripe.successUrl,
  });
  if (!portal.url) {
    throw new Error("Stripe did not return a portal URL");
  }
  return portal.url;
}
