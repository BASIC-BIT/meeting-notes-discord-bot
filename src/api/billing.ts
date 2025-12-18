import express from "express";
import Stripe from "stripe";
import {
  getGuildSubscription,
  writeGuildSubscription,
  writePaymentTransaction,
} from "../db";
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
        if (!config.stripe.priceBasic?.startsWith("price_")) {
          console.error(
            "Stripe price not configured: expected STRIPE_PRICE_BASIC to be a price_ id, got",
            config.stripe.priceBasic,
          );
          res
            .status(500)
            .json({ error: "Stripe price not configured. Contact admin." });
          return;
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
        res.json({ url: session.url });
      } catch (err) {
        console.error("Stripe checkout error", err);
        res.status(500).json({ error: "Unable to create checkout session" });
      }
    },
  );

  app.get("/api/billing/me", requireAuth, async (req, res): Promise<void> => {
    const guildId = (req.query.guildId as string) || "";
    if (!guildId) {
      res.json({
        tier: "free",
        status: "free",
        upgradeUrl: config.stripe.billingLandingUrl || null,
        portalUrl: null,
        billingEnabled: false,
        stripeMode: config.subscription.stripeMode || "disabled",
      });
      return;
    }
    try {
      if (!stripe || !config.stripe.secretKey) {
        res.json({
          tier: "free",
          status: "free",
          upgradeUrl: config.stripe.billingLandingUrl || null,
          portalUrl: null,
          billingEnabled: false,
          stripeMode: config.subscription.stripeMode || "disabled",
        });
        return;
      }

      const subscription = await getGuildSubscription(guildId);
      const status = subscription?.status || "free";
      const nextBillingDate = subscription?.nextBillingDate || null;

      res.json({
        tier: status === "free" ? "free" : "basic",
        status,
        nextBillingDate,
        subscriptionId: subscription?.stripeSubscriptionId || null,
        customerId: subscription?.stripeCustomerId || null,
        upgradeUrl: config.stripe.billingLandingUrl || null,
        portalUrl: `${req.protocol}://${req.get("host")}/api/billing/portal?guildId=${guildId}`,
        billingEnabled: true,
        stripeMode: config.subscription.stripeMode || "live",
      });
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
        const subscription = await getGuildSubscription(guildId);
        let customerId =
          subscription?.stripeCustomerId ||
          (typeof subscription?.stripeSubscriptionId === "string"
            ? (
                await stripe.subscriptions.retrieve(
                  subscription.stripeSubscriptionId,
                )
              ).customer?.toString()
            : undefined);
        if (!customerId) {
          customerId = await ensureStripeCustomer(stripe, user);
        }
        if (!customerId) {
          res.status(404).json({ error: "No Stripe customer found for guild" });
          return;
        }
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: config.stripe.portalReturnUrl || config.stripe.successUrl,
        });
        res.json({ url: portal.url });
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

async function ensureStripeCustomer(
  stripe: Stripe,
  user: { id: string; email?: string; username?: string },
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
