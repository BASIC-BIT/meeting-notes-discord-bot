import express from "express";
import Stripe from "stripe";
import { writeGuildSubscription, writePaymentTransaction } from "../db";
import {
  buildBillingDisabledSnapshot,
  createCheckoutSession,
  createPortalSession,
  getBillingSnapshot,
} from "../services/billingService";
import { config } from "../services/configService";

type AuthedUser = {
  id: string;
  email?: string;
  username?: string;
  accessToken?: string;
};

export function registerBillingRoutes(
  app: express.Express,
  stripe: Stripe | null,
) {
  // Checkout session (guild-based)
  app.post(
    "/api/billing/checkout",
    requireAuth,
    async (req, res): Promise<void> => {
      if (!stripe) {
        res.status(500).json({ error: "Stripe not configured" });
        return;
      }
      try {
        const user = req.user as AuthedUser;
        const guildId = (req.query.guildId as string) || "";
        if (!guildId) {
          res.status(400).json({ error: "guildId is required" });
          return;
        }
        const url = await createCheckoutSession({
          stripe,
          user,
          guildId,
        });
        res.json({ url });
      } catch (err) {
        console.error("Stripe checkout error", err);
        res.status(500).json({ error: "Unable to create checkout session" });
      }
    },
  );

  app.get("/api/billing/me", requireAuth, async (req, res): Promise<void> => {
    const guildId = (req.query.guildId as string) || "";
    if (!guildId) {
      res.json(buildBillingDisabledSnapshot());
      return;
    }
    try {
      if (!stripe || !config.stripe.secretKey) {
        res.json(buildBillingDisabledSnapshot());
        return;
      }
      const snapshot = await getBillingSnapshot({
        stripe,
        guildId,
        host: req.get("host") ?? "",
        protocol: req.protocol,
      });
      res.json(snapshot);
    } catch (err) {
      console.error("Stripe me endpoint error", err);
      res.status(500).json({ error: "Unable to fetch billing status" });
    }
  });

  app.post(
    "/api/billing/portal",
    requireAuth,
    async (req, res): Promise<void> => {
      if (!stripe) {
        res.status(500).json({ error: "Stripe not configured" });
        return;
      }
      const user = req.user as AuthedUser;
      const guildId = (req.query.guildId as string) || "";
      if (!guildId) {
        res.status(400).json({ error: "guildId is required" });
        return;
      }
      try {
        const url = await createPortalSession({
          stripe,
          user,
          guildId,
        });
        res.json({ url });
      } catch (err) {
        console.error("Stripe portal error", err);
        res.status(500).json({ error: "Unable to create portal session" });
      }
    },
  );

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
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const guildId =
            (session.metadata as Record<string, string> | undefined)
              ?.guild_id || "";
          if (guildId && session.subscription) {
            const sub = await stripe.subscriptions.retrieve(
              session.subscription as string,
            );
            await writeGuildSubscription({
              guildId,
              status: sub.status,
              tier: "basic",
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
                (session.metadata as Record<string, string> | undefined)
                  ?.discord_id || undefined,
              priceId:
                typeof sub.items?.data?.[0]?.price?.id === "string"
                  ? sub.items?.data?.[0]?.price?.id
                  : undefined,
            });
          }
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const guildId =
            (invoice.metadata as Record<string, string> | undefined)
              ?.guild_id || "";
          if (guildId) {
            await writeGuildSubscription({
              guildId,
              status: "past_due",
              tier: "basic",
              startDate: new Date(invoice.created * 1000).toISOString(),
              paymentMethod: invoice.default_payment_method
                ? "card"
                : "unknown",
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
            });
          }
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const guildId =
            (subscription.metadata as Record<string, string> | undefined)
              ?.guild_id || "";
          if (guildId) {
            await writeGuildSubscription({
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
            });
          }
          break;
        }
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          const guildId =
            (invoice.metadata as Record<string, string> | undefined)
              ?.guild_id || "";
          await writePaymentTransaction({
            transactionID: invoice.id,
            userID: guildId || "",
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

// Middleware placeholder to satisfy type checking; actual requireAuth is defined in webserver
const requireAuth: express.RequestHandler = (req, res, next): void => {
  const maybeReq = req as express.Request & {
    isAuthenticated?: () => boolean;
  };
  if (maybeReq.isAuthenticated && maybeReq.isAuthenticated()) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
};
