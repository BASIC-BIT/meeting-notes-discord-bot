import { z } from "zod";
import { introOfferAuthoritySchema } from "./introOfferAuthority";
import { offerTermsSchema } from "./offerUsage";
import { introOfferIdSchema } from "./basicIntroOffers";

const id = z.string().min(1);
const seconds = z.number().int().nonnegative();
const money = z.number().int();
export const billingChangeSelectionSchema = z
  .object({
    tier: z.enum(["free", "basic", "pro"]),
    interval: z.enum(["month", "year"]),
    expectedOffer: z.enum(["none", "basic_intro_v1", "basic_annual_intro_v1"]),
  })
  .strict();
export const billingChangeQuoteSchema = z
  .object({
    targetTier: z.enum(["free", "basic", "pro"]),
    interval: z.enum(["month", "year"]),
    effectiveAt: z.iso.datetime(),
    timing: z.enum(["immediate", "renewal"]),
    currency: z.string().length(3),
    chargeLabel: id,
    chargePeriod: z.string().nullable(),
    creditLabel: id,
    planCharge: money.nonnegative(),
    offerSavings: money.nonnegative(),
    unusedCredit: money.nonnegative(),
    taxAmount: money.nonnegative(),
    taxTreatment: z.enum(["added", "included"]),
    billingBalance: money,
    amountDue: money.nonnegative(),
    remainingCredit: money.nonnegative(),
    nextPlanRate: money.nonnegative().nullable(),
    nextAt: z.iso.datetime().nullable(),
    offerTerms: z.string().nullable(),
    endingOffer: z.enum(["monthly", "annual"]).nullable(),
  })
  .strict();
export const billingChangeSourceSchema = z
  .object({
    subscriptionId: id,
    customerId: id,
    itemId: id,
    priceId: id,
    tier: z.enum(["basic", "pro"]),
    interval: z.enum(["month", "year"]),
    periodStart: seconds,
    periodEnd: seconds,
    fingerprint: id,
    billingMode: z.enum(["classic", "flexible"]),
    revision: z.string().nullable(),
    at: seconds,
  })
  .strict();
export const billingChangeTargetSchema = z
  .object({
    selection: billingChangeSelectionSchema,
    priceId: z.string().nullable(),
    productId: z.string().nullable(),
    unitAmount: money.nonnegative(),
    currency: id,
    taxBehavior: z.enum(["inclusive", "exclusive"]),
    offer: z
      .object({
        id: introOfferIdSchema,
        terms: offerTermsSchema,
        authority: introOfferAuthoritySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
const funding = z
  .object({
    invoiceId: id,
    total: money,
    amountDue: money.nonnegative(),
    currency: id,
    startingBalance: money,
    endingBalance: money,
    serviceValue: money,
  })
  .strict();
const base = z.object({
  guildId: z.string().regex(/^\d{17,20}$/),
  operationId: z.uuid(),
  revision: id,
  payerId: id,
  mode: z.enum(["live", "test"]),
  createdAt: seconds,
  source: billingChangeSourceSchema,
  target: billingChangeTargetSchema,
  timing: z.enum(["immediate", "renewal"]),
  quote: billingChangeQuoteSchema,
  expiresAt: seconds,
});
const accepted = z.object({ at: seconds, quoteRevision: id }).strict();
export const billingChangeOperationSchema = z.discriminatedUnion("state", [
  base.extend({ state: z.literal("preparing") }).strict(),
  base
    .extend({ state: z.literal("review"), funding: funding.nullable() })
    .strict(),
  base
    .extend({
      state: z.literal("accepted"),
      funding: funding.nullable(),
      consent: accepted,
    })
    .strict(),
  base
    .extend({ state: z.literal("applying"), funding, consent: accepted })
    .strict(),
  base
    .extend({
      state: z.literal("scheduled"),
      scheduleId: id.nullable(),
      consent: accepted,
    })
    .strict(),
  base
    .extend({
      state: z.literal("canceling"),
      funding: funding.nullable(),
      scheduleId: id.nullable(),
      consent: accepted.nullable(),
    })
    .strict(),
  base
    .extend({
      state: z.literal("succeeded"),
      funding: funding.nullable(),
      scheduleId: id.nullable(),
      appliedAt: seconds,
      consent: accepted,
    })
    .strict(),
  base.extend({ state: z.literal("canceled"), completedAt: seconds }).strict(),
]);
export type BillingChangeOperation = z.infer<
  typeof billingChangeOperationSchema
>;
export type BillingChangeQuote = z.infer<typeof billingChangeQuoteSchema>;
export type BillingChangeSelection = z.infer<
  typeof billingChangeSelectionSchema
>;
export type BillingChangeSource = z.infer<typeof billingChangeSourceSchema>;
export type BillingChangeTarget = z.infer<typeof billingChangeTargetSchema>;
export type BillingChangeFunding = z.infer<typeof funding>;
export type BillingChangeView =
  | { kind: "none"; enabled: boolean }
  | {
      kind: "operation";
      operationId: string;
      revision: string;
      state: BillingChangeOperation["state"];
      quote: BillingChangeQuote;
      paymentUrl: string | null;
    };
export const billingChangeOperationKey = (
  guildId: string,
  operationId: string,
) => `CHANGE_OP#${guildId}#${operationId}`;
export const billingChangeControlKey = (guildId: string) =>
  `CHANGE_CONTROL#${guildId}`;
export const isBillingChangeComplete = (operation: BillingChangeOperation) =>
  operation.state === "succeeded" || operation.state === "canceled";
