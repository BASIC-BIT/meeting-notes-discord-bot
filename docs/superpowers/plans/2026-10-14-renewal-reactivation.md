# Renewal reactivation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized payer turn renewal back on for the same paid subscription after seeing its verified date and rate, while keeping cancellation, payment history and terminal repurchase understandable.

**Architecture:** A focused renewal service owns eligibility, a signed consent quote and a minimal Stripe update. Namespaced operation/control records in the existing GuildSubscription table preserve duplicate and timeout recovery. The existing reconciliation service remains authoritative for access; unsupported states use the existing payer-checked portal.

**Tech stack:** Node.js 24.15.0, TypeScript, tRPC/Zod, Stripe SDK pinned to API `2026-07-29.dahlia`, DynamoDB, React 19/Mantine, Jest, Storybook and Playwright.

**Spec:** [Turn subscription renewal back on](../specs/2026-10-14-renewal-reactivation-design.md). Read it before executing. UX direction is approved; this design/plan is for review. Implementation, provider writes and activation are not authorized by the current planning task.

## Global constraints

- Use **Renewal off**, **Turn renewal back on**, **Payment history** and **View invoices and receipts** as specified. Do not use em dashes or the word upfront.
- Preserve the same subscription/item/customer, billing mode, paid period, anchor, price, quantity, discounts, account balance and offer-use records. No unintended immediate invoice, payment, charge or proration.
- Show authoritative renewal date, recurring rate and tax basis before consent. Keep any valid remaining offer; never restart one.
- Keep Manage Server and original-payer checks. A manager who is not the payer cannot restore or manage the existing subscription. Terminal repurchase retains the existing Checkout authorization and may use a new payer without granting access to the old billing account.
- Use `2026-07-29.dahlia`; verify effective API headers in native acceptance. Never use the paused-subscription resume endpoint.
- Use separate default-false `STRIPE_RENEWAL_REACTIVATION_ENABLED`. It must not enable hosted plan switching or prevent reconciliation of a previously submitted renewal operation.
- Keep uncertain outcomes recoverable. No fallback Checkout for a nonterminal subscription, no customer-wide lock and no schedule release.
- Preserve the centered Monthly/Annual selector, Upgrade comparison, existing complimentary access and current payment-failure entitlement policy.
- Native proof uses new owned Sandbox fixtures only, with separate execution authorization and cleanup. Never mutate the already cleaned parent test subscription.
- Do not add analytics events or properties, change production settings or infer deployment from source tests.

## Review focus

These are review priorities, not omitted tests. Each is pinned to a task below.

1. A custom cancellation can shorten item period end. Equal dates alone must not qualify it for direct reactivation. Task 1 and Task 3 verify the independent paid boundary.
2. A timed-out request can have succeeded. An expired quote or a new button click must not create a second operation. Task 2 and Task 3 verify durable recovery.
3. An external portal/admin edit can race the final read. Task 1 and Task 3 must detect drift and avoid false success or destructive compensation.
4. A valid remaining discount, inclusive tax or account balance can differ from the sample. Task 1, Task 3 and Task 4 verify truthful rate copy and preserved billing state.
5. A server manager can view the plan without being its payer. Task 3 and Task 4 must preserve read access while denying writable actions and receipt-account access.

## Delivery order and ownership

| Task | Reviewable result                                                              | Dependency                                                   |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1    | Accepted native update contract, or evidence that blocks the direct route      | Separate Sandbox execution authority                         |
| 2    | Typed consent, durable operation storage and disabled-by-default configuration | Spec; can prepare locally while native proof is pending      |
| 3    | Protected API with recovery of the same operation and authoritative readback   | Task 1 must accept the candidate before connecting its write |
| 4    | Revised Billing card and payment history, with responsive proof                | Task 2 contract; fixtures can precede Task 3                 |
| 5    | Integrated checks, docs and exact-head review packet                           | Tasks 1 through 4                                            |

This is one narrow feature. It does not implement the separate plan-switching payment adapter or editable subscription schedules.

## Task 1: Prove the native reactivation contract

**Files:**

- Create in private ops: `evidence/2026-10-14-renewal-reactivation/README.md` and `results.json`.
- Create in private ops: `evidence/2026-10-14-renewal-reactivation/renewal-reactivation-probe.ps1`, a scoped on-demand fixture controller with `-BillingMode classic|flexible` and `-Case <case>`.
- Update the existing private billing owner note with the result pointer. Do not copy provider identities or raw receipts into product docs.

**Interfaces:**

- Consumes the pinned Stripe API, authorized Sandbox route and new owned fixtures.
- Produces a sanitized accepted request contract for `clearPendingCancellation` in Task 3, plus private per-case snapshots and cleanup results.

- [ ] **Step 1: Establish scope before creating a fixture.** Read private ops instructions, the Dev/Sandbox runbook and existing billing evidence. Discover the intended tool route; use only its recorded fallback after reporting a route failure. Verify account, test mode and effective API. Stop if execution authority or private identity evidence is absent. Do not run this task merely because the plan exists.
- [ ] **Step 2: Build a failing acceptance packet.** Cases must assert the required result, not an HTTP 200 response alone. Include classic period-end flag, flexible dated cancellation, annual introductory history with regular renewal, remaining monthly discount, inclusive/exclusive tax, repeat request, cancel-again, lost response, pending payment, custom date, schedule and a concurrent native edit.

```text
acceptedUndo:
  same subscription, item, customer and mode
  cancellation cleared; natural paid boundary and anchor unchanged
  same price, quantity, discounts, balance and offer-use records
  invoice/payment-intent/charge sets unchanged by undo
  no proration item created
```

- [ ] **Step 3: Prove the read-only preview before the write.** Preview the cancellation removal on the same subscription. Verify the next recurring service rate, cadence, tax basis and boundary. Reject unsupported lines or schedules. Preview must create no persisted invoice or payment. A zero-cash application invoice is not independent proof of the paid-service boundary.
- [ ] **Step 4: Test only the minimal candidate.** Classic candidate: `cancel_at_period_end=false, proration_behavior=none`. Flexible candidate: `cancel_at='', proration_behavior=none`. Supply no items, price, discounts, anchor or payment parameters. If the pinned API requires a different request, record the mismatch and revise the spec before implementation.
- [ ] **Step 5: Verify native readback and legitimate renewal.** Compare complete before/after inventories. Replay the same request/key, cancel again and verify an old completed operation is not reissued. Advance an owned test clock to the real renewal, then verify its invoice and applicable discount. Exercise an externally changed price/date/schedule and record whether drift is detected. An unexpected immediate charge or changed anchor fails acceptance.
- [ ] **Step 6: Verify fallback and clean up.** Read the actual portal configuration and test the claimed general-management recovery without changing shared/default settings. Record cases requiring support rather than promising schedule editing. Clean up only owned fixtures, then reconcile every held resource. Preserve historical invoices and the previously cleaned parent subscription.
- [ ] **Step 7: Save proof through the private repo policy.** The probe is executable research, so its reusable source uses a topic branch/PR there. Commit only intended files. Record pass, rejected and unverified cases separately. No activation follows from passing proof.

## Task 2: Define consent and operation storage

**Files:**

- Create: `src/types/renewal.ts`, `src/services/renewalQuote.ts`, `src/repositories/renewalReactivationRepository.ts`.
- Modify: `src/db.ts`, `src/repositories/mockStore.ts`, `src/services/configService.ts`, `_infra/main.tf`, `_infra/tfvars.example`.
- Test: `test/services/renewalQuote.test.ts`, `test/repositories/renewalReactivationRepository.test.ts`, `test/services/billingActivationConfig.test.ts`.

**Interfaces:**

- `RenewalTerms`: tier, interval, currency, next recurring `unitAmount` in minor units, `taxBehavior: 'exclusive' | 'inclusive'`, `renewsAt`, and `discount: null | { endsAt; regularUnitAmount }`.
- `RenewalQuote`: `purpose: 'billing_renewal_v1'`, nonce, guild/payer/subscription IDs, saved subscription revision or null, source fingerprint, terms, issuedAt and expiresAt in milliseconds.
- `RenewalRequest`: `{ kind: 'confirm'; quoteToken: string } | { kind: 'recover'; operationId: string }`.
- `RenewalOperation`: immutable operation/quote nonce, server/payer/mode/source/terms/request/idempotency binding; a discriminated state of applying, verifying, succeeded, rejected or needs_review. Each state carries only its required result/reason fields.
- `RenewalControl` is `{ guildId: string; operationId: string; revision: string }`. Its presence means that operation still owns the server's renewal control. Release deletes only that matching control.
- Repository signatures: `getOperation({guildId, operationId}): Promise<RenewalOperation | undefined>`, `getControl({guildId}): Promise<RenewalControl | undefined>`, `claim({operation, expectedSubscription}): Promise<boolean>`, `compareAndWrite({next, expectedRevision}): Promise<boolean>`. The argument types are the named domain records plus strings for IDs/revisions. `expectedSubscription` is the existing `GuildSubscription` row.
- Pin operation field names used across tasks: `operationId`, `quoteNonce`, `guildId`, `payerId`, `mode`, `subscriptionId`, `sourceFingerprint`, `invariantFingerprint`, `sourceRevision`, `approvedTerms`, `stripeRequest`, `idempotencyKey`, `firstAttemptAt`, `revision`, `state`. `stripeRequest` is the accepted minimal Stripe SubscriptionUpdateParams subset. The invariant fingerprint covers fields that must stay unchanged and excludes the cancellation fields being cleared. `firstAttemptAt` is recorded conservatively when the first write is claimed, so a crash cannot extend the 23-hour retry limit.
- `signRenewalQuote(quote): string` and `readRenewalQuote(token, now): RenewalQuote | undefined` reuse `src/utils/consentToken.ts` with a strict Zod payload and a renewal-specific derived signing key.
- `RenewalView` carries `{ state: RenewalState; canManageBilling: boolean }`. Its permission is verified from current payer metadata, including for an already-renewing or terminal subscription. Payment history must not infer it from `hasStripeBilling` or the old broad `canManageBillingPortal` field.
- Define the shared state shape in Task 2's `src/types/renewal.ts` before using it:

```ts
type RenewalAction =
  | {
      kind: "ready";
      quoteToken: string;
      expiresAt: number;
      terms: RenewalTerms;
    }
  | {
      kind: "review_in_stripe";
      reason:
        | "unsupported_state"
        | "payment_problem"
        | "direct_unavailable"
        | "unverified_terms";
    }
  | { kind: "payer_required" }
  | { kind: "unavailable" };
type RenewalState =
  | { kind: "off"; tier: PaidTier; endsAt: string; action: RenewalAction }
  | { kind: "on"; terms: RenewalTerms }
  | { kind: "processing"; operationId: string; endsAt: string }
  | { kind: "needs_review"; operationId: string; knownEndsAt: string | null }
  | { kind: "terminal" }
  | { kind: "not_applicable" }
  | { kind: "unavailable"; knownEndsAt: string | null };
```

Derive `PaidTier` and `BillingInterval` from existing pricing types. An unresolved payment uses the off/provider-review branch only when a future cancellation is known; otherwise it remains the existing payment-status view. Do not reinterpret unavailable state as terminal or Free.

- [ ] **Step 1: Write failing quote/repository/config tests.** Pin the five-minute lifetime, purpose and actor binding. Reject altered payloads, wrong purpose, another server/payer, expired new consent and unsupported terms. Assert that two claims on one source allow one winner, another server remains independent, and subscription/purchase/offer rows are untouched.

```ts
expect(readRenewalQuote(tamperedToken, now)).toBeUndefined();
expect(readRenewalQuote(token, issuedAt + 300_000)).toBeUndefined();
expect(
  await Promise.all([
    repo.claim({ operation: first, expectedSubscription }),
    repo.claim({ operation: competing, expectedSubscription }),
  ]),
).toEqual(expect.arrayContaining([true, false]));
expect(mockStore.purchaseAttempts).toEqual(beforePurchases);
expect(mockStore.offerUsages).toEqual(beforeOffers);
```

- [ ] **Step 2: Run the new focused tests and confirm failure.** Use `node node_modules/jest/bin/jest.js test/services/renewalQuote.test.ts test/repositories/renewalReactivationRepository.test.ts test/services/billingActivationConfig.test.ts --runInBand --coverage=false`. Failure must be the missing contract, not an unrelated environment error.
- [ ] **Step 3: Implement the protocol and durable claim.** Use `RENEWAL_OP#<guildId>#<nonce>` for operations and `RENEWAL_CONTROL#<guildId>` for the active pointer in the existing GuildSubscription table. A transaction condition-checks the saved subscription ID/revision, creates the new operation once and claims an absent control. Terminal completion releases only its own control; the immutable operation remains readable. Keep incomplete operations recoverable without time-based control stealing. A signed quote is not itself the replay record.
- [ ] **Step 4: Add the separate default-false gate.** Map exact env value `true` to `config.stripe.renewalReactivationEnabled`. Add matching boolean Terraform input/env wiring and example, following the existing transition gate in `_infra/main.tf`. Do not change `STRIPE_SUBSCRIPTION_TRANSITIONS_ENABLED`. Test unset, false and mixed-case values stay disabled. No Terraform apply or runtime setting change.
- [ ] **Step 5: Run the focused tests, root TypeScript and lint.** Verify real Dynamo command shapes and conditional failures as well as the mock store. No extra table, secret or broad IAM grant is required. Validate any policy effect before assuming existing permissions cover the transaction.
- [ ] **Step 6: Commit this independently testable protocol.** Stage only Task 2 files. Suggested message: `Add guarded renewal consent and operation storage`.

## Task 3: Implement the protected renewal API and recovery

**Files:**

- Create: `src/services/renewalProvider.ts`, `src/services/renewalReactivationService.ts`, `src/services/billingPayerService.ts`.
- Modify: `src/services/billingService.ts`, `src/trpc/routers/billing.ts`. Reuse `src/services/subscriptionReconciliation.ts`; change it only if a demonstrated integration need requires it.
- Test: `test/services/renewalProvider.test.ts`, `test/services/renewalReactivationService.test.ts`, `test/trpc/renewal.test.ts`, existing `test/services/billingTransition.test.ts`, `test/services/basicIntroOfferService.test.ts` and `test/api/billing.test.ts`.

**Interfaces:**

- `readRenewalState({stripe, guildId, payerId, now}): Promise<RenewalView>` owns native reads, preview and the ready quote. `now` defaults to Date.now inside the service.
- `restoreRenewal({stripe, guildId, payerId, request, now}): Promise<RenewalResult>` consumes Task 2's request and durable operation contract.
- `readRenewalSource({stripe, guildId, subscriptionId}): Promise<RenewalSource>` validates native identity, independent paid boundary, payment state, tax basis and source fingerprint.
- `clearPendingCancellation({stripe, operation}): Promise<void>` sends only Task 1's accepted exact body and immutable idempotency key.
- `assertStripePayer({stripe, customerId, payerId}): Promise<void>` centralizes the existing metadata check; migrate both current billing-service callers without weakening their association checks.
- `billing.renewal` is a Manage Server query with `{serverId}`. `billing.reactivateRenewal` is a Manage Server mutation with `{serverId, request: RenewalRequest}`. Mutation success never comes from browser-supplied terms.
- Consumes Task 2's `RenewalView`, `RenewalState` and `RenewalAction`. Payment problems never imply terminal status or Free.
- `RenewalResult` is confirmed with verified terms, changed requiring new review, processing with operation ID, or needs_review. Authorization failures use the existing BillingActionError mapping.

- [ ] **Step 1: Write failing service and API tests.** Name and pin: `classic_flag_undo_preserves_contract`, `flexible_date_undo_preserves_contract`, `custom_shortened_period_requires_provider_review`, `manager_is_not_payer`, `expired_quote_cannot_start_operation`, `remaining_monthly_offer_is_not_restarted`, `inclusive_price_is_not_labeled_before_tax`, `another_server_is_unchanged`, `disabled_gate_blocks_new_write`, `terminal_never_calls_update`, `terminal_checkout_new_payer_cannot_view_old_receipts`.

```ts
expect(result.kind).toBe("confirmed");
expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
expect(stripe.subscriptions.resume).not.toHaveBeenCalled();
expect(mockStore.offerUsages).toEqual(beforeOffers);
```

Add failure cases for unresolved payment, missing payer metadata, subscription/customer/mode mismatch, unsupported discount, invoice-preview failure and existing schedule. Readable state is distinct from permission to write or open the payer's receipts.

- [ ] **Step 2: Run focused tests and confirm the expected failures.** Use the four new service/API test paths with Jest `--runInBand --coverage=false`. Keep test fixtures explicitly typed; inspect the installed SDK's preview-line format rather than assuming an older API shape.
- [ ] **Step 3: Implement read and consent.** Query current provider state and the independently verified paid boundary. Preview only Task 1's accepted cancellation removal. Build the quote from verified service terms, not the initial invoice cash amount or a public catalog guess. Include relevant item/period/price/discount/tax/payment/schedule state in the fingerprint. Return payer_required to a permitted nonpayer viewer without issuing a writable quote.
- [ ] **Step 4: Implement claim, apply and reconcile.** Check gate and current permissions, validate the token, claim the server control, then re-read and compare the source before sending the minimal update. Call `reconcileSubscription(stripe, guildId, subscriptionId)` and verify its consistent saved result after independent native readback. Confirm only if cancellation is gone and all invariant terms match. Do not write offer usage, reserve an offer, create Checkout or call a collection API.
- [ ] **Step 5: Pin recovery and external races before declaring success.** Add `lost_update_response_recovers_same_operation`, `persistence_failure_stays_processing`, `quote_expiry_does_not_erase_submitted_operation`, `old_completed_request_cannot_undo_later_cancel`, `concurrent_native_terms_require_review`, `webhook_and_request_reconcile_current_state`, `disabling_gate_preserves_read_recovery`. Retry writes only with the original request/key within 23 hours of the first attempted update, inside Stripe's documented minimum 24-hour API v1 retention. Outside it, require review rather than risking a new write. When the action gate is off, recovery may read and persist verified outcomes but may not send an update retry. Keep unresolved control records for review. Confirmed old operations return current status on replay, never a new undo. Post-write drift becomes needs_review with verified facts and no automatic price rollback or recancellation.
- [ ] **Step 6: Run focused and existing billing regressions.** New tests plus `billingTransition`, `basicIntroOfferService` and `test/api/billing.test.ts` must pass. Run root `tsc --noEmit --incremental false`, scoped ESLint and the repository complexity check without new suppressions. Inspect behavior at the explicit provider/app boundaries.
- [ ] **Step 7: Commit the protected API.** Suggested message: `Restore renewal on the existing verified subscription`. Keep the gate false.

## Task 4: Revise the current-plan card and payment history

**Files:**

- Create: `src/frontend/components/BillingRenewalStatus.tsx`, `src/frontend/components/BillingPaymentHistory.tsx`.
- Modify: `src/frontend/pages/Billing.tsx`, `src/frontend/components/SubscriptionDetails.tsx`, `src/frontend/pages/UpgradePlans.stories.tsx`, `src/frontend/pages/basicIntroFixtures.ts`, `src/frontend/utils/billingManagement.ts` only where state classification needs it.
- Test: `test/e2e/billingMocks.ts`, `test/e2e/billing.spec.ts`, `test/e2e/visual.spec.ts`, affected snapshots in `test/e2e/visual.spec.ts-snapshots` and Storybook play functions.

**Interfaces:**

- `BillingRenewalStatus({state, canManageBilling, onConfirm, onCheckStatus, onRetry, onPortal, busy})` renders Task 3's RenewalState. onConfirm accepts the server-issued quote token; onCheckStatus recovers the existing operation. The component never derives provider terms.
- `BillingPaymentHistory({firstYearPayment, previousStatus, canViewReceipts, onViewReceipts, busy})` receives the existing verified FirstYearPayment DTO and uses RenewalView.canManageBilling for the original payer's receipt action.
- Billing owns the `billing.renewal` query and reactivation mutation. It passes the returned state and verified canManageBilling permission to both new components. After a confirmed result, invalidate both renewal and billing.me, then show reconciled current data. A stale first-year display cannot overwrite the confirmed terms.

- [ ] **Step 1: Write the failing browser and Storybook assertions.** The annual renewal-off fixture must show one end-date statement, no ACTIVE badge, the $100 renewal rate, a primary **Turn renewal back on**, secondary **Manage billing**, and first-year invoice details only inside **Payment history**. Include a normal renewal-on state, confirmed success, processing, read/update failure, nonpayer, payment problem, schedule/provider review and terminal Free.

```ts
await expect(current.getByText("Renewal off", { exact: true })).toBeVisible();
await expect(current.getByText("ACTIVE", { exact: true })).toHaveCount(0);
await expect(current).toContainText("Your Basic plan ends October 12, 2027.");
await expect(current).toContainText("$100/year before tax");
await expect(current).not.toContainText("First year paid");
await expect(history).toContainText("$64.20");
await expect(
  history.getByRole("button", { name: "View invoices and receipts" }),
).toBeEnabled();
```

- [ ] **Step 2: Verify the failing UI behavior.** Run the new Billing tests with `PW_VISUAL=false`. Start/reuse Storybook on its verified port and run the focused renewal tag. Failures must correspond to the current screenshot's hierarchy or missing new states.
- [ ] **Step 3: Implement the approved hierarchy.** Use the two focused components to keep Billing.tsx from accumulating another large nested state block. Replace the old broad action group; every portal/receipt button uses the verified canManageBilling permission, with backend checks still authoritative. Put server, renewal-off badge, end date, verified rate and primary action before usage/features. Remove duplicate renewal/cancellation lines from SubscriptionDetails and move payment amounts/coverage into Payment history. Use an existing accordion for those details, with a visible receipt action. Preserve the comparison selector and existing non-Stripe/grant states.
- [ ] **Step 4: Wire consent and recovery.** The primary button consumes the quote displayed on the card. If it expired or changed, refresh terms and require another deliberate click, never auto-submit updated consent. While unresolved, show Checking renewal and recover the same operation. Payment/update failures must not claim success. Nonpayer and provider-review states must route as the spec says. **Get Basic again** reuses verified-terminal Checkout and the selected existing interval; it does not call reactivation.
- [ ] **Step 5: Prove responsive behavior and scrolling.** Use 1280x720, 768x900 and 390x844. Include off/on/processing/failure/history-open/terminal fixtures in visual coverage. Assert no horizontal overflow. For short-height overflow, identify the actual scroll container, assert `scrollHeight > clientHeight`, scroll it and assert scrollTop changes; do not merely check element visibility. The button and receipt action remain reachable. Capture Storybook screenshots with the repo runner and inspect them with a VLM. Inspect Playwright snapshots too. Update only intended baselines, then rerun without updates.
- [ ] **Step 6: Run browser and component checks, then commit.** Run affected Billing Playwright tests, the renewal Storybook tag, root types, scoped lint/format and complexity checks. Review copy with unslop. Suggested message: `Clarify renewal status and payment history`.

## Task 5: Integrate, document and prepare review

**Files:**

- Modify: `apps/docs-site/docs/features/feature-overview.md`, `docs/billing-subscription-transitions.md`, `_infra/README.md` if the new gate needs an operator explanation.
- Update: this plan's checkboxes and exact evidence appendix, plus the existing private billing owner note for native acceptance references.

**Interfaces:**

- Produces one coherent branch with the new direct action disabled by default, a readable test/acceptance packet, and no deployment or activation claim.
- Existing initial Checkout, provider management, current-state webhooks and offer ledger remain unchanged outside the named integration.

- [ ] **Step 1: Trace the complete same-subscription journey.** Run the UI through quote, click, native update, current-state reconciliation and confirmed card in signed-in Sandbox only after execution authorization. Verify receipts, return server context, nonpayer denial and terminal repurchase separately. Never restore the cleaned parent fixture.
- [ ] **Step 2: Update public and operator docs.** Explain renewal off, who may restore renewal, the date/rate shown before consent, payment-history access and terminal repurchase. Document the separate flag and recovery behavior. Do not publish private fixture identities or claim that all schedules are editable in Stripe.
- [ ] **Step 3: Run the appropriate full affected checks.** Jest for the new renewal, billing activation, consent/repository and existing billing/webhook suites; `PW_VISUAL=false` Billing browser tests; `PW_VISUAL=true` affected visuals; Storybook capture after Playwright finishes; root types, scoped lint/Prettier, docs build and full complexity check. Avoid racing the Storybook runner with Playwright report writes. New failures or changed code justify repeat checks; otherwise proceed to review.
- [ ] **Step 4: Review the actual branch, not only helper tests.** Inspect authorization, source association, inclusive-tax copy, quote replay after cancel-again, external-race behavior, unresolved operations, same-subscription invariants and default-false gate. Separate mock proof, native provider proof, signed-in app proof, CI and runtime evidence.
- [ ] **Step 5: Prepare the PR under the active authorization.** If publishing is authorized, use a concise problem/behavior description with relevant validation, attach the PR, and follow the repository's exact-head 30-minute gate plus all mutable review/check surfaces before calling it merge-ready. Every new commit restarts the window. Do not merge, deploy, enable the flag or perform production billing writes under design/planning authority.

## Self-review and open gates

The design's UX states map to Task 4, provider boundaries and source races to Tasks 1/3, consent/storage to Task 2, and release evidence to Task 5. Public signatures above are the only new cross-task contract; internal helpers remain the implementer's choice. Task 4 can use fixtures before the provider is accepted, but cannot certify Task 3 through those mocks.

Native proof may reject the candidate. That is a release gate, not permission to substitute Checkout or silently weaken the invariants. External Stripe edits remain an explicit limitation; a failed concurrency test requires a design revision.

No additional pricing decision remains. Before implementation, review the recommended direct route, inline consent and separate disabled-by-default gate. Native execution is the suggested implementation approach because these tasks share one source/operation contract and can be completed sequentially, with an independent whole-branch review afterward. The earlier planning request does not choose or authorize that execution method.

## Evidence appendix

Planning source: local branch `codex/plan-switching` at `20b038b8d6d40fe0a198ff06ca61c9e7b842fff4`. Current cancellation source is already saved in `e340763e89b1b0bcd7fedabf359e2957e566cfb0`; it recognizes both representations and clears stored cancellation on authoritative resume-shaped data. It does not implement a reactivation mutation.

Current stories are under `src/frontend/pages/UpgradePlans.stories.tsx`; the baseline reference is `pages-upgradeplans--intro-subscriber-canceled`. Current static preview uses localhost:6106. Existing provider/production evidence is separately owned and is not acceptance for the new action.

Builder check on the design: a fresh software-engineering reviewer reported **nothing important left**. This plan then received the writing-plans self-review and an unslop pass. No planned implementation or provider tests have been executed by writing this document.
