import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { GuildSubscription } from "./db";
import {
  offerUsageSchema,
  assertUsageTransition,
  assertSettlement,
  type OfferUsageMutation,
} from "./offerUsage";
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

export type BillingChangeClaim = {
  operation: BillingChangeOperation;
  expectedSubscription: GuildSubscription;
  usage?: OfferUsageMutation;
};
export type BillingChangeWrite = {
  next: BillingChangeOperation;
  expectedRevision: string;
  usage?: OfferUsageMutation;
};
export const billingChangeBase = (operation: BillingChangeOperation) =>
  base.parse(operation);
const transitions: Record<
  BillingChangeOperation["state"],
  BillingChangeOperation["state"][]
> = {
  preparing: ["preparing", "review", "canceling"],
  review: ["accepted", "canceling"],
  accepted: ["applying", "scheduled", "canceling"],
  applying: ["applying", "succeeded", "canceling"],
  scheduled: ["scheduled", "succeeded", "canceling"],
  canceling: ["canceling", "canceled"],
  succeeded: [],
  canceled: [],
};
export function assertBillingChangeTransition(
  next: BillingChangeOperation,
  previous: BillingChangeOperation,
) {
  if (
    !transitions[previous.state].includes(next.state) ||
    next.revision === previous.revision
  )
    throw new Error("Invalid plan change state transition");
  const {
    revision: oldRevision,
    quote: oldQuote,
    ...oldBase
  } = base.parse(previous);
  const {
    revision: newRevision,
    quote: newQuote,
    ...newBase
  } = base.parse(next);
  if (
    !isDeepStrictEqual(oldBase, newBase) ||
    (previous.state !== "preparing" && !isDeepStrictEqual(oldQuote, newQuote))
  )
    throw new Error("Frozen plan change terms cannot change");
  void oldRevision;
  void newRevision;
  if (
    "funding" in previous &&
    "funding" in next &&
    !isDeepStrictEqual(previous.funding, next.funding)
  )
    throw new Error("Bound plan change invoice cannot change");
  if (
    "consent" in previous &&
    previous.consent &&
    "consent" in next &&
    !isDeepStrictEqual(previous.consent, next.consent)
  )
    throw new Error("Plan change consent cannot change");
}

export function parseChangeUsage(
  operation: BillingChangeOperation,
  mutation: OfferUsageMutation,
) {
  const next = offerUsageSchema.parse(mutation.next);
  const expected =
    mutation.expected === undefined
      ? undefined
      : offerUsageSchema.parse(mutation.expected);
  const owner =
    next.state === "unused" ? next.released.operationId : next.operationId;
  if (
    !operation.target.offer ||
    next.guildId !== operation.guildId ||
    next.mode !== operation.mode ||
    next.offerId !== operation.target.offer.id ||
    owner !== operation.operationId
  )
    throw new Error("Plan change offer scope mismatch");
  assertUsageTransition(next, expected);
  assertSettlement(next, expected);
  if (
    next.state !== "unused" &&
    !isDeepStrictEqual(next.terms, operation.target.offer.terms)
  )
    throw new Error("Plan change reservation terms mismatch");
  if (
    mutation.authority &&
    !isDeepStrictEqual(mutation.authority, operation.target.offer.authority)
  )
    throw new Error("Plan change history authority mismatch");
  if (
    (next.state === "reserved" && operation.state !== "preparing") ||
    (next.state === "used" && operation.state !== "succeeded") ||
    (next.state === "unused" && operation.state !== "canceled")
  )
    throw new Error("Offer result does not match plan change");
  if (next.state === "reserved" && !mutation.authority)
    throw new Error("Fresh plan change offer requires history authority");
  return { next, expected, authority: mutation.authority };
}
