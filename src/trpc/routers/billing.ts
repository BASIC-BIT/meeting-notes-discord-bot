import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  buildBillingDisabledSnapshot,
  createCheckoutSession,
  createPortalSession,
  getBillingSnapshot,
  getMockBillingSnapshot,
  seedMockSubscription,
} from "../../services/billingService";
import { resolvePaidPlanPriceId } from "../../services/pricingService";
import { getStripeClient } from "../../services/stripeClient";
import { config } from "../../services/configService";
import { requireManageGuild } from "../permissions";
import { authedProcedure, manageGuildProcedure, router } from "../trpc";
import type { BillingInterval, PaidTier } from "../../types/pricing";

const me = authedProcedure
  .input(z.object({ serverId: z.string().optional() }))
  .query(async ({ ctx, input }) => {
    if (!input.serverId) {
      return buildBillingDisabledSnapshot();
    }
    await requireManageGuild({
      accessToken: ctx.user.accessToken,
      guildId: input.serverId,
    });
    if (config.mock.enabled) {
      return getMockBillingSnapshot(input.serverId);
    }
    const stripe = getStripeClient();
    if (!stripe || !config.stripe.secretKey) {
      return buildBillingDisabledSnapshot();
    }
    return getBillingSnapshot({
      stripe,
      guildId: input.serverId,
    });
  });

const checkout = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      tier: z.enum(["basic", "pro"]),
      interval: z.enum(["month", "year"]).default("month"),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (config.mock.enabled) {
      await seedMockSubscription(input.serverId);
      return { url: `/portal/server/${input.serverId}/billing?mock=checkout` };
    }
    const stripe = getStripeClient();
    if (!stripe) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe not configured",
      });
    }
    try {
      let priceId =
        (await resolvePaidPlanPriceId({
          stripe,
          tier: input.tier as PaidTier,
          interval: input.interval as BillingInterval,
        })) || null;
      if (!priceId && input.tier === "basic" && config.stripe.priceBasic) {
        priceId = config.stripe.priceBasic;
      }
      if (!priceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pricing unavailable for selected plan",
        });
      }
      const url = await createCheckoutSession({
        stripe,
        user: {
          id: ctx.user.id,
          email: ctx.user.email ?? undefined,
          username: ctx.user.username ?? undefined,
        },
        guildId: input.serverId,
        priceId,
      });
      return { url };
    } catch (err) {
      console.error("Stripe checkout error", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to create checkout session",
      });
    }
  });

const portal = manageGuildProcedure
  .input(z.object({ serverId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    if (config.mock.enabled) {
      return { url: `/portal/server/${input.serverId}/billing?mock=portal` };
    }
    const stripe = getStripeClient();
    if (!stripe) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe not configured",
      });
    }
    try {
      const url = await createPortalSession({
        stripe,
        user: {
          id: ctx.user.id,
          email: ctx.user.email ?? undefined,
          username: ctx.user.username ?? undefined,
        },
        guildId: input.serverId,
      });
      return { url };
    } catch (err) {
      console.error("Stripe portal error", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to create portal session",
      });
    }
  });

export const billingRouter = router({
  me,
  checkout,
  portal,
});
