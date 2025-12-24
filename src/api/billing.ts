import express from "express";
import Stripe from "stripe";
import {
  recordPaymentTransaction,
  saveGuildSubscription,
} from "../services/billingService";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { config } from "../services/configService";
import { resolveTierFromPrice } from "../services/pricingService";
import { getStripeWebhookRepository } from "../repositories/stripeWebhookRepository";

type KnownTier = "free" | "basic" | "pro";

const normalizeTier = (tier?: string | null): KnownTier | null => {
  if (tier === "free" || tier === "basic" || tier === "pro") {
    return tier;
  }
  return null;
};

const readMetadataValue = (
  metadata: Record<string, string> | null | undefined,
  key: string,
): string => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
};

const resolveTierFromSubscription = (
  subscription: Stripe.Subscription,
): KnownTier => {
  const price = subscription.items?.data?.[0]?.price;
  const tier =
    resolveTierFromPrice({
      priceId: price?.id,
      lookupKey: price?.lookup_key,
    }) ?? null;
  return tier ?? "basic";
};

const resolveTierFromInvoice = (invoice: Stripe.Invoice): KnownTier | null => {
  const price = invoice.lines?.data?.[0]?.price;
  const tier =
    resolveTierFromPrice({
      priceId: price?.id,
      lookupKey: price?.lookup_key,
    }) ?? null;
  return tier;
};

const resolveGuildIdFromInvoice = async (
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<string> => {
  const fromDetails = readMetadataValue(
    invoice.subscription_details?.metadata,
    "guild_id",
  );
  if (fromDetails) return fromDetails;

  if (invoice.subscription && typeof invoice.subscription !== "string") {
    const fromSubscription = readMetadataValue(
      invoice.subscription.metadata,
      "guild_id",
    );
    if (fromSubscription) return fromSubscription;
  }

  if (typeof invoice.subscription === "string") {
    const subscription = await stripe.subscriptions.retrieve(
      invoice.subscription,
    );
    return readMetadataValue(subscription.metadata, "guild_id");
  }

  return "";
};

export function registerBillingRoutes(
  app: express.Express,
  stripe: Stripe | null,
) {
  app.post("/api/billing/webhook", async (req, res): Promise<void> => {
    if (!stripe || !config.stripe.webhookSecret) {
      res.status(500).send("Stripe webhook not configured");
      return;
    }
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        config.stripe.webhookSecret,
      );
    } catch (err) {
      console.error("Stripe webhook signature error", err);
      res.status(400).send("Bad signature");
      return;
    }

    try {
      const webhookRepo = getStripeWebhookRepository();
      const existing = await webhookRepo.get(event.id);
      if (existing) {
        res.json({ received: true });
        return;
      }
      const ttlSeconds = 60 * 60 * 24 * 30;
      await webhookRepo.write({
        eventId: event.id,
        receivedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
      });

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (!session.subscription) break;
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
          );
          const guildId =
            readMetadataValue(session.metadata, "guild_id") ||
            readMetadataValue(sub.metadata, "guild_id");
          if (!guildId) {
            console.warn(
              "Stripe checkout session missing guild_id metadata",
              session.id,
            );
            break;
          }
          const tier = resolveTierFromSubscription(sub);
          await saveGuildSubscription({
            guildId,
            status: sub.status,
            tier,
            startDate: new Date(sub.start_date * 1000).toISOString(),
            endDate: sub.ended_at
              ? new Date(sub.ended_at * 1000).toISOString()
              : undefined,
            nextBillingDate: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : undefined,
            paymentMethod: session.payment_method_types?.[0],
            subscriptionType: "stripe",
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : undefined,
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : undefined,
            updatedAt: new Date().toISOString(),
            updatedBy:
              readMetadataValue(session.metadata, "discord_id") ||
              readMetadataValue(sub.metadata, "discord_id") ||
              undefined,
            priceId:
              typeof sub.items?.data?.[0]?.price?.id === "string"
                ? sub.items?.data?.[0]?.price?.id
                : undefined,
            mode: sub.livemode ? "live" : "test",
          });
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const guildId = await resolveGuildIdFromInvoice(stripe, invoice);
          if (!guildId) {
            console.warn(
              "Stripe invoice missing guild_id metadata",
              invoice.id,
            );
            break;
          }
          const existing = await getSubscriptionRepository().get(guildId);
          const existingTier = normalizeTier(existing?.tier);
          const tierFromInvoice = resolveTierFromInvoice(invoice);
          await saveGuildSubscription({
            guildId,
            status: "past_due",
            tier:
              tierFromInvoice ??
              (existingTier && existingTier !== "free"
                ? existingTier
                : "basic"),
            startDate:
              existing?.startDate ??
              new Date(invoice.created * 1000).toISOString(),
            nextBillingDate: invoice.next_payment_attempt
              ? new Date(invoice.next_payment_attempt * 1000).toISOString()
              : existing?.nextBillingDate,
            paymentMethod: invoice.default_payment_method ? "card" : "unknown",
            subscriptionType: "stripe",
            stripeCustomerId:
              typeof invoice.customer === "string"
                ? invoice.customer
                : undefined,
            stripeSubscriptionId:
              typeof invoice.subscription === "string"
                ? invoice.subscription
                : undefined,
            updatedAt: new Date().toISOString(),
            priceId:
              typeof invoice.lines?.data?.[0]?.price?.id === "string"
                ? invoice.lines?.data?.[0]?.price?.id
                : existing?.priceId,
            mode: invoice.livemode ? "live" : "test",
          });
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          const guildId = readMetadataValue(subscription.metadata, "guild_id");
          if (!guildId) {
            console.warn(
              "Stripe subscription missing guild_id metadata",
              subscription.id,
            );
            break;
          }
          const tier = resolveTierFromSubscription(subscription);
          await saveGuildSubscription({
            guildId,
            status: subscription.status,
            tier,
            startDate: new Date(subscription.start_date * 1000).toISOString(),
            endDate: subscription.ended_at
              ? new Date(subscription.ended_at * 1000).toISOString()
              : undefined,
            nextBillingDate: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : undefined,
            paymentMethod: subscription.default_payment_method
              ? "card"
              : "unknown",
            subscriptionType: "stripe",
            stripeCustomerId:
              typeof subscription.customer === "string"
                ? subscription.customer
                : undefined,
            stripeSubscriptionId: subscription.id,
            updatedAt: new Date().toISOString(),
            updatedBy:
              readMetadataValue(subscription.metadata, "discord_id") ||
              undefined,
            priceId:
              typeof subscription.items?.data?.[0]?.price?.id === "string"
                ? subscription.items?.data?.[0]?.price?.id
                : undefined,
            mode: subscription.livemode ? "live" : "test",
          });
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const guildId = readMetadataValue(subscription.metadata, "guild_id");
          if (guildId) {
            await saveGuildSubscription({
              guildId,
              status: "canceled",
              tier: "free",
              startDate: new Date(subscription.start_date * 1000).toISOString(),
              endDate: subscription.ended_at
                ? new Date(subscription.ended_at * 1000).toISOString()
                : new Date().toISOString(),
              nextBillingDate: undefined,
              paymentMethod: undefined,
              subscriptionType: "stripe",
              stripeCustomerId:
                typeof subscription.customer === "string"
                  ? subscription.customer
                  : undefined,
              stripeSubscriptionId: subscription.id,
              updatedAt: new Date().toISOString(),
              mode: subscription.livemode ? "live" : "test",
            });
          }
          break;
        }
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          const guildId = await resolveGuildIdFromInvoice(stripe, invoice);
          if (!guildId) {
            console.warn(
              "Stripe invoice missing guild_id metadata",
              invoice.id,
            );
            break;
          }
          await recordPaymentTransaction({
            transactionID: invoice.id,
            userID: guildId,
            amount: (invoice.amount_paid || 0) / 100,
            currency: invoice.currency,
            status: invoice.status || "paid",
            paymentDate: new Date(invoice.created * 1000).toISOString(),
            paymentMethod: invoice.default_payment_method ? "card" : "unknown",
            discountCode: invoice.discount?.coupon?.id,
            subscriptionID: invoice.subscription
              ? String(invoice.subscription)
              : "",
            customerId:
              typeof invoice.customer === "string"
                ? invoice.customer
                : undefined,
          });
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook handler error", err);
      res.status(500).send("Webhook handler failure");
    }
  });
}
