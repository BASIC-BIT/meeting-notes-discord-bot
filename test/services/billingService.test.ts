import { describe, expect, it, jest } from "@jest/globals";
import type Stripe from "stripe";
import { resolvePromotionCodeId } from "../../src/services/billingService";

describe("resolvePromotionCodeId", () => {
  it("returns null for blank codes", async () => {
    const stripe = {
      promotionCodes: {
        list: jest.fn(),
      },
    } satisfies Pick<Stripe, "promotionCodes">;

    await expect(resolvePromotionCodeId(stripe, " ")).resolves.toBeNull();
    expect(stripe.promotionCodes.list).not.toHaveBeenCalled();
  });

  it("returns the first matching promotion code id", async () => {
    const stripe = {
      promotionCodes: {
        list: jest.fn().mockResolvedValue({ data: [{ id: "promo_123" }] }),
      },
    } satisfies Pick<Stripe, "promotionCodes">;

    await expect(resolvePromotionCodeId(stripe, "SAVE20")).resolves.toBe(
      "promo_123",
    );
    expect(stripe.promotionCodes.list).toHaveBeenCalledWith({
      code: "SAVE20",
      active: true,
      limit: 1,
    });
  });

  it("returns null when no promo codes match", async () => {
    const stripe = {
      promotionCodes: {
        list: jest.fn().mockResolvedValue({ data: [] }),
      },
    } satisfies Pick<Stripe, "promotionCodes">;

    await expect(resolvePromotionCodeId(stripe, "MISSING")).resolves.toBeNull();
  });
});
