import { captureRenewalOperationEvent } from "./billingLifecycleAnalytics";
import {
  renewalBindingSchema,
  renewalOperationSchema,
  type RenewalTerms,
  type RenewalQuote,
} from "../types/renewal";
import { randomUUID } from "node:crypto";
import { getSubscriptionRepository } from "../repositories/subscriptionRepository";
import { getRenewalReactivationRepository } from "../repositories/renewalReactivationRepository";
import type { StripeClient } from "../types/stripe";
import type {
  RenewalOperation,
  RenewalRequest,
  RenewalResult,
  RenewalView,
  RenewalState,
} from "../types/renewal";
import { config } from "./configService";
import {
  readRenewalSource,
  clearPendingCancellation,
  type RenewalSource,
} from "./renewalProvider";
import {
  readRenewalQuote,
  readRenewalRecoveryQuote,
  signRenewalQuote,
} from "./renewalQuote";
import { reconcileSubscription } from "./subscriptionReconciliation";
import { BillingActionError } from "./billingActionError";
type Context = {
  stripe: StripeClient;
  guildId: string;
  payerId: string;
  now?: number;
};
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const isPayer = (source: RenewalSource, payerId: string) =>
  source.customer.metadata.discord_id === payerId;
function operationState(
  operation: RenewalOperation,
  knownEndsAt: string | null,
): RenewalState {
  return operation.state === "needs_review"
    ? { kind: "needs_review", operationId: operation.operationId, knownEndsAt }
    : {
        kind: "processing",
        operationId: operation.operationId,
        endsAt: operation.approvedTerms.renewsAt,
      };
}
export async function readRenewalState({
  stripe,
  guildId,
  payerId,
  now = Date.now(),
}: Context): Promise<RenewalView> {
  const saved = await getSubscriptionRepository().get(guildId);
  const view = (
    state: RenewalState,
    canManageBilling = false,
  ): RenewalView => ({
    state,
    canManageBilling,
    lifecycleAnalyticsEnabled: config.analytics.billingLifecycleEnabled,
  });
  if (!saved?.stripeSubscriptionId) return view({ kind: "not_applicable" });
  let recovery: RenewalOperation | undefined;
  try {
    const control = await getRenewalReactivationRepository().getControl({
      guildId,
    });
    const controlPresent = Boolean(control);
    if (control) {
      const operation = await getRenewalReactivationRepository().getOperation({
        guildId,
        operationId: control.operationId,
      });
      if (
        operation &&
        operation.payerId === payerId &&
        operation.subscriptionId === saved.stripeSubscriptionId &&
        operation.state !== "succeeded" &&
        operation.state !== "rejected"
      )
        recovery = operation;
    }
    const source = await readRenewalSource({
      stripe,
      guildId,
      subscriptionId: saved.stripeSubscriptionId,
    });
    const payer = isPayer(source, payerId);
    if (source.kind === "terminal") return view({ kind: "terminal" }, payer);
    if (payer && recovery)
      return view(
        operationState(
          recovery,
          source.cancellationAt ? iso(source.cancellationAt) : null,
        ),
        payer,
      );
    if (source.cancellationAt === null)
      return source.kind === "verified"
        ? view({ kind: "on", terms: source.terms }, payer)
        : view({ kind: "unavailable", knownEndsAt: null }, payer);
    const tier = source.kind === "verified" ? source.terms.tier : saved.tier;
    if (tier !== "basic" && tier !== "pro")
      return view(
        { kind: "unavailable", knownEndsAt: iso(source.cancellationAt) },
        payer,
      );
    const base = {
      kind: "off",
      tier,
      endsAt: iso(source.cancellationAt),
    } satisfies Pick<
      Extract<RenewalState, { kind: "off" }>,
      "kind" | "tier" | "endsAt"
    >;
    if (!payer) return view({ ...base, action: { kind: "payer_required" } });
    if (controlPresent && !recovery)
      return view(
        {
          ...base,
          action: { kind: "review_in_stripe", reason: "unsupported_state" },
        },
        true,
      );
    if (source.kind !== "verified")
      return view(
        {
          ...base,
          action: { kind: "review_in_stripe", reason: source.reason },
        },
        true,
      );
    if (!config.stripe.renewalReactivationEnabled)
      return view(
        {
          ...base,
          action: { kind: "review_in_stripe", reason: "direct_unavailable" },
        },
        true,
      );
    if (source.cancellationAt * 1000 <= now)
      return view(
        {
          ...base,
          action: { kind: "review_in_stripe", reason: "unverified_terms" },
        },
        true,
      );
    const quote: RenewalQuote = {
      purpose: "billing_renewal_v1",
      nonce: randomUUID(),
      guildId,
      payerId,
      subscriptionId: source.subscription.id,
      sourceRevision: saved.stripeSyncRevision ?? null,
      sourceFingerprint: source.sourceFingerprint,
      terms: source.terms,
      issuedAt: now,
      expiresAt: now + 300000,
    };
    return view(
      {
        ...base,
        action: {
          kind: "ready",
          terms: quote.terms,
          quoteToken: signRenewalQuote(quote),
          expiresAt: quote.expiresAt,
        },
      },
      true,
    );
  } catch {
    if (recovery)
      return view(
        operationState(
          recovery,
          saved.cancellationAt ?? recovery.approvedTerms.renewsAt,
        ),
      );
    return view({
      kind: "unavailable",
      knownEndsAt: saved.cancellationAt ?? null,
    });
  }
}
export async function restoreRenewal({
  stripe,
  guildId,
  payerId,
  request,
  analyticsOptOut,
  now = Date.now(),
}: Context & {
  request: RenewalRequest;
  analyticsOptOut: boolean;
}): Promise<RenewalResult> {
  const repo = getRenewalReactivationRepository();
  const signed =
    request.kind === "confirm"
      ? readRenewalRecoveryQuote(request.quoteToken, { guildId, payerId })
      : undefined;
  const operationId =
    request.kind === "recover" ? request.operationId : signed?.nonce;
  if (!operationId) return { kind: "changed" };
  let prior = await repo.getOperation({ guildId, operationId });
  if (prior) {
    if (prior.payerId !== payerId)
      throw new BillingActionError(
        "FORBIDDEN",
        "Only the original payer can manage this server's Stripe billing",
      );
    if (
      signed &&
      (signed.subscriptionId !== prior.subscriptionId ||
        signed.sourceFingerprint !== prior.sourceFingerprint)
    )
      return { kind: "changed" };
    if (prior.state === "rejected") return { kind: "changed" };
    if (
      analyticsOptOut &&
      !prior.analyticsOptOut &&
      prior.state !== "succeeded"
    ) {
      const optedOut = {
        ...prior,
        analyticsOptOut: true,
        revision: randomUUID(),
      };
      if (
        !(await repo.compareAndWrite({
          next: optedOut,
          expectedRevision: prior.revision,
        }))
      )
        return { kind: "processing", operationId: prior.operationId };
      prior = optedOut;
    }
    return recover({ stripe, guildId, payerId, now }, prior);
  }
  if (request.kind !== "confirm" || !config.stripe.renewalReactivationEnabled)
    return { kind: "changed" };
  const quote = readRenewalQuote(request.quoteToken, now, { guildId, payerId });
  if (!quote) return { kind: "changed" };
  const saved = await getSubscriptionRepository().get(guildId);
  if (
    !saved ||
    saved.stripeSubscriptionId !== quote.subscriptionId ||
    (saved.stripeSyncRevision ?? null) !== quote.sourceRevision
  )
    return { kind: "changed" };
  const source = await readRenewalSource({
    stripe,
    guildId,
    subscriptionId: quote.subscriptionId,
  });
  if (!isPayer(source, payerId))
    throw new BillingActionError(
      "FORBIDDEN",
      "Only the original payer can manage this server's Stripe billing",
    );
  if (
    source.kind !== "verified" ||
    source.cancellationAt === null ||
    source.sourceFingerprint !== quote.sourceFingerprint
  )
    return { kind: "changed" };
  const operation: RenewalOperation = {
    operationId: quote.nonce,
    quoteNonce: quote.nonce,
    guildId,
    payerId,
    mode: source.subscription.livemode ? "live" : "test",
    subscriptionId: source.subscription.id,
    sourceFingerprint: source.sourceFingerprint,
    invariantFingerprint: source.invariantFingerprint,
    sourceRevision: quote.sourceRevision,
    approvedTerms: quote.terms,
    stripeRequest: source.stripeRequest,
    idempotencyKey: `renewal-${source.subscription.livemode ? "live" : "test"}-${guildId}-${quote.nonce}`,
    firstAttemptAt: now,
    analyticsOptOut:
      analyticsOptOut ||
      source.subscription.metadata.analytics_opt_out === "true",
    revision: randomUUID(),
    state: "applying",
  };
  if (!(await repo.claim({ operation, expectedSubscription: saved })))
    return { kind: "changed" };
  await captureRenewalOperationEvent({ operation, phase: "requested" });
  return recover({ stripe, guildId, payerId, now }, operation);
}
async function recover(
  context: Required<Context>,
  operation: RenewalOperation,
): Promise<RenewalResult> {
  const { stripe, guildId, payerId, now } = context;
  const repo = getRenewalReactivationRepository();
  const next = (
    result:
      | { state: "verifying" }
      | { state: "succeeded"; verifiedTerms: RenewalTerms }
      | {
          state: "needs_review";
          reason: "terms_changed" | "retry_window_elapsed";
        },
  ) =>
    renewalOperationSchema.parse({
      ...renewalBindingSchema.parse(operation),
      revision: randomUUID(),
      ...result,
    });
  const save = async (next: RenewalOperation) => {
    const accepted = await repo.compareAndWrite({
      next,
      expectedRevision: operation.revision,
    });
    if (
      accepted &&
      operation.state !== "needs_review" &&
      ["succeeded", "rejected", "needs_review"].includes(next.state)
    )
      await captureRenewalOperationEvent({ operation: next, phase: "result" });
    return accepted;
  };
  const processing = (): RenewalResult => ({
    kind: "processing",
    operationId: operation.operationId,
  });
  try {
    const saved = await getSubscriptionRepository().get(guildId);
    if (saved?.stripeSubscriptionId !== operation.subscriptionId) {
      if (operation.state === "succeeded") return { kind: "changed" };
      await save(next({ state: "needs_review", reason: "terms_changed" }));
      return { kind: "needs_review", operationId: operation.operationId };
    }
    let source = await readRenewalSource({
      stripe,
      guildId,
      subscriptionId: operation.subscriptionId,
    });
    if (!isPayer(source, payerId))
      throw new BillingActionError(
        "FORBIDDEN",
        "Only the original payer can manage this server's Stripe billing",
      );
    if (operation.state === "succeeded")
      return source.kind === "verified" &&
        source.cancellationAt === null &&
        source.invariantFingerprint === operation.invariantFingerprint
        ? { kind: "confirmed", terms: source.terms }
        : { kind: "changed" };
    if (
      source.kind !== "verified" ||
      source.invariantFingerprint !== operation.invariantFingerprint
    ) {
      await save(next({ state: "needs_review", reason: "terms_changed" }));
      return { kind: "needs_review", operationId: operation.operationId };
    }
    if (source.cancellationAt !== null) {
      if (source.sourceFingerprint !== operation.sourceFingerprint) {
        await save(next({ state: "needs_review", reason: "terms_changed" }));
        return { kind: "needs_review", operationId: operation.operationId };
      }
      if (now - operation.firstAttemptAt >= 23 * 60 * 60 * 1000) {
        await save(
          next({ state: "needs_review", reason: "retry_window_elapsed" }),
        );
        return { kind: "needs_review", operationId: operation.operationId };
      }
      if (
        !config.stripe.renewalReactivationEnabled ||
        operation.state === "needs_review"
      )
        return processing();
      try {
        await clearPendingCancellation({ stripe, operation });
      } catch {
        /* A transport failure can hide a successful update. Always read back. */
      }
      if (operation.state === "applying") {
        const verifying = next({ state: "verifying" });
        if (!(await save(verifying))) return processing();
        operation = verifying;
      }
      source = await readRenewalSource({
        stripe,
        guildId,
        subscriptionId: operation.subscriptionId,
      });
    }
    if (
      source.kind !== "verified" ||
      source.invariantFingerprint !== operation.invariantFingerprint
    ) {
      await save(next({ state: "needs_review", reason: "terms_changed" }));
      return { kind: "needs_review", operationId: operation.operationId };
    }
    if (source.cancellationAt !== null) return processing();
    await reconcileSubscription(
      stripe,
      guildId,
      operation.subscriptionId,
      undefined,
      { userId: payerId, analyticsOptOut: operation.analyticsOptOut },
    );
    const persisted = await getSubscriptionRepository().get(guildId);
    const confirmed = await readRenewalSource({
      stripe,
      guildId,
      subscriptionId: operation.subscriptionId,
    });
    if (
      confirmed.kind !== "verified" ||
      confirmed.cancellationAt !== null ||
      confirmed.invariantFingerprint !== operation.invariantFingerprint ||
      persisted?.stripeSubscriptionId !== operation.subscriptionId ||
      persisted.cancellationAt
    )
      return processing();
    if (
      !(await save(
        next({ state: "succeeded", verifiedTerms: confirmed.terms }),
      ))
    )
      return processing();
    return { kind: "confirmed", terms: confirmed.terms };
  } catch (error) {
    if (error instanceof BillingActionError && error.code === "FORBIDDEN")
      throw error;
    if (error instanceof BillingActionError && error.code === "BAD_REQUEST") {
      if (operation.state === "succeeded") return { kind: "changed" };
      try {
        if (
          await save(next({ state: "needs_review", reason: "terms_changed" }))
        )
          return { kind: "needs_review", operationId: operation.operationId };
      } catch {
        /* Keep the existing durable control if persistence is unavailable. */
      }
    }
    return processing();
  }
}
