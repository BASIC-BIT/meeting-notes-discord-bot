import { TRPCError } from "@trpc/server";
import { config } from "../../services/configService";
import { getPaidPlans, getMockPaidPlans } from "../../services/pricingService";
import { getStripeClient } from "../../services/stripeClient";
import { publicProcedure, router } from "../trpc";

export const pricingRouter = router({
  plans: publicProcedure.query(async () => {
    if (config.mock.enabled) {
      return { plans: getMockPaidPlans() };
    }
    const stripe = getStripeClient();
    if (!stripe || !config.stripe.secretKey) {
      return { plans: getMockPaidPlans() };
    }
    try {
      const plans = await getPaidPlans(stripe);
      return { plans: plans.length ? plans : getMockPaidPlans() };
    } catch (err) {
      console.error("Failed to load pricing from Stripe", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to load pricing",
      });
    }
  }),
});
