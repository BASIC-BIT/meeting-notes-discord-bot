import { TRPCError } from "@trpc/server";
import { getBasicIntroOffer } from "../../services/basicIntroOfferService";
import type { BasicIntroOffer } from "../../types/pricing";
import { config } from "../../services/configService";
import { getPaidPlans, getMockPaidPlans } from "../../services/pricingService";
import { getStripeClient } from "../../services/stripeClient";
import { publicProcedure, router } from "../trpc";

export const pricingRouter = router({
  plans: publicProcedure.query(async () => {
    if (config.mock.enabled) {
      return {
        plans: getMockPaidPlans(),
        introOffer: { status: "inactive" } satisfies BasicIntroOffer,
      };
    }
    const stripe = getStripeClient();
    if (!stripe || !config.stripe.secretKey) {
      return {
        plans: getMockPaidPlans(),
        introOffer: {
          status: Object.values(config.stripe.basicIntroOffer).some(Boolean)
            ? "unavailable"
            : "inactive",
        } satisfies BasicIntroOffer,
      };
    }
    try {
      const plans = await getPaidPlans(stripe);
      return {
        plans: plans.length ? plans : getMockPaidPlans(),
        introOffer: await getBasicIntroOffer({ stripe, plans }),
      };
    } catch (err) {
      console.error("Failed to load pricing from Stripe", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to load pricing",
      });
    }
  }),
});
