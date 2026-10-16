import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

const seconds = z.number().int().nonnegative();
const id = z.string().min(1);
export const RENEWAL_GRACE_SECONDS = 172800;
export const RENEWAL_RECOVERY_DUE_INDEX = "RenewalRecoveryDueIndex";
export const renewalGraceDeadline = (finalizedAt: number): number =>
  seconds.parse(finalizedAt) + RENEWAL_GRACE_SECONDS;
const paid = z
  .object({
    invoiceId: id,
    priceId: id,
    tier: z.enum(["basic", "pro"]),
    interval: z.enum(["month", "year"]),
    periodStart: seconds,
    periodEnd: seconds,
  })
  .strict()
  .refine((value) => value.periodEnd > value.periodStart);
const base = z
  .object({
    guildId: z.string().regex(/^\d{17,20}$/),
    subscriptionId: id,
    customerId: id,
    payerId: id,
    mode: z.enum(["test", "live"]),
    revision: id,
    paid,
    scheduledOperationId: id.nullable(),
    enforcementAccepted: z.boolean(),
  })
  .strict();
const bound = base.extend({
  invoice: z
    .object({
      id,
      lineId: id,
      finalizedAt: seconds,
      periodStart: seconds,
      periodEnd: seconds,
    })
    .strict(),
  endsAt: seconds,
});
export const renewalRecoveryReceiptsSchema = z
  .object({
    creditNoteId: id.nullable(),
    refundIds: z.array(id),
    canceled: z.boolean(),
    unrelatedInvoices: z
      .array(z.object({ id, autoAdvance: z.boolean() }).strict())
      .default([]),
  })
  .strict();
export const renewalRecoverySchema = z
  .discriminatedUnion("state", [
    base
      .extend({ state: z.literal("watching"), nextCheckAt: seconds })
      .strict(),
    base.extend({ state: z.literal("ended") }).strict(),
    bound.extend({ state: z.literal("grace"), nextCheckAt: seconds }).strict(),
    bound
      .extend({
        state: z.literal("canceling"),
        nextCheckAt: seconds,
        reason: z.enum(["payer", "expired"]),
        receipts: renewalRecoveryReceiptsSchema,
      })
      .strict(),
    bound
      .extend({
        state: z.literal("paid"),
        projection: z.discriminatedUnion("state", [
          z
            .object({ state: z.literal("pending"), nextCheckAt: seconds })
            .strict(),
          z.object({ state: z.literal("complete") }).strict(),
        ]),
      })
      .strict(),
    bound
      .extend({
        state: z.literal("canceled"),
        reason: z.enum(["payer", "expired"]),
        receipts: renewalRecoveryReceiptsSchema,
      })
      .strict(),
  ])
  .superRefine((record, context) => {
    if (
      record.state !== "watching" &&
      record.state !== "ended" &&
      record.endsAt !== renewalGraceDeadline(record.invoice.finalizedAt)
    )
      context.addIssue({
        code: "custom",
        message: "Renewal grace deadline must match provider finalization",
      });
  });
export type RenewalRecovery = z.infer<typeof renewalRecoverySchema>;
export type RenewalRecoveryReceipts = z.infer<
  typeof renewalRecoveryReceiptsSchema
>;
export const renewalRecoveryKey = (
  record: Pick<RenewalRecovery, "guildId" | "subscriptionId" | "paid">,
) =>
  `RENEWAL_RECOVERY#${record.guildId}#${record.subscriptionId}#${record.paid.periodEnd}`;
export const renewalRecoveryCurrentKey = (guildId: string) =>
  `RENEWAL_RECOVERY_CURRENT#${guildId}`;
export const renewalRecoveryPointerSchema = z
  .object({ key: id, revision: id, blocking: z.boolean() })
  .strict();
export type RenewalRecoveryPointer = z.infer<
  typeof renewalRecoveryPointerSchema
>;
export const isRenewalRecoveryBlocking = (record: RenewalRecovery) =>
  record.enforcementAccepted &&
  (record.state === "grace" ||
    record.state === "canceling" ||
    (record.state === "paid" && record.projection.state === "pending"));
export const renewalRecoveryNextCheck = (
  record: RenewalRecovery,
): number | undefined =>
  "nextCheckAt" in record
    ? record.nextCheckAt
    : record.state === "paid" && record.projection.state === "pending"
      ? record.projection.nextCheckAt
      : undefined;
const transitions: Record<
  RenewalRecovery["state"],
  RenewalRecovery["state"][]
> = {
  watching: ["watching", "grace", "paid", "ended"],
  ended: [],
  grace: ["grace", "canceling", "paid"],
  canceling: ["canceling", "paid", "canceled"],
  paid: ["paid"],
  canceled: [],
};
export function assertRenewalRecoveryTransition(
  next: RenewalRecovery,
  previous: RenewalRecovery,
): void {
  next = renewalRecoverySchema.parse(next);
  previous = renewalRecoverySchema.parse(previous);
  if (
    next.revision === previous.revision ||
    !transitions[previous.state].includes(next.state)
  )
    throw new Error("Invalid renewal recovery transition");
  if (
    previous.state === "paid" &&
    (previous.projection.state !== "pending" ||
      next.state !== "paid" ||
      next.projection.state !== "complete")
  )
    throw new Error("Paid renewal requires projection reconciliation");
  for (const field of [
    "guildId",
    "subscriptionId",
    "customerId",
    "payerId",
    "mode",
    "paid",
  ] as const)
    if (!isDeepStrictEqual(next[field], previous[field]))
      throw new Error("Renewal paid source is immutable");
  if (previous.enforcementAccepted && !next.enforcementAccepted)
    throw new Error("Accepted renewal recovery cannot be disabled");
  assertBoundRenewalRecovery(next, previous);
}
function assertBoundRenewalRecovery(
  next: RenewalRecovery,
  previous: RenewalRecovery,
): void {
  if (previous.state === "watching" || previous.state === "ended") return;
  if (next.state === "watching" || next.state === "ended")
    throw new Error("Bound renewal cannot become a watch");
  if (
    !isDeepStrictEqual(next.invoice, previous.invoice) ||
    next.scheduledOperationId !== previous.scheduledOperationId ||
    next.endsAt !== previous.endsAt
  )
    throw new Error("Bound renewal invoice and deadline are immutable");
}

export const renewalRecoveryCursorSchema = z
  .object({
    guildId: id,
    recoveryQueue: z.enum(["test", "live"]),
    recoveryDueAt: seconds,
  })
  .strict();
export function readRenewalRecoveryCursor(cursor: string | undefined) {
  return cursor
    ? renewalRecoveryCursorSchema.parse(
        JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
      )
    : undefined;
}
export const writeRenewalRecoveryCursor = (
  key: z.infer<typeof renewalRecoveryCursorSchema>,
) => Buffer.from(JSON.stringify(key)).toString("base64url");
