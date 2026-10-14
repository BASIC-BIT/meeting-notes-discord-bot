# Turn subscription renewal back on

## Review brief

A server that has paid time remaining should keep its Basic or Pro plan and clearly show **Renewal off**. Its Billing card should explain when access ends and offer one direct way to keep the subscription. The current ACTIVE badge, repeated cancellation date and first-year invoice details obscure that choice.

The UX direction below is approved. This document recommends a provider route and defines the checks needed before implementation can be accepted. No cancellation undo, payment, deployment or activation is authorized by this design task.

**Recommendation:** use an in-app action backed by a narrowly scoped Stripe subscription update for a verified, simple active subscription. Keep Stripe management as the alternative for unsupported schedules, payment problems or uncertain terms. This preserves the existing subscription and avoids sending ordinary renewals through plan selection or Checkout.

The tradeoff is additional consent and recovery code. Stripe supports reversing a pending cancellation, but our exact update and portal configuration still require Sandbox proof. External Stripe edits cannot be made atomic with a Chronote preflight check. Detect changed terms before the write and verify them afterward; never present an uncertain result as success.

## The Billing experience

### Paid access with renewal off

The Engineering HQ annual example reads:

> **Basic · Renewal off**  
> Your Basic plan ends October 12, 2027.  
> Turn renewal back on to continue at $100/year before tax.  
> **Turn renewal back on** · Manage billing

Show the server name once. The primary button is explicit consent to the verified renewal terms displayed immediately beside it. A normal reactivation needs no additional tier-selection page or confirmation modal. This is a recommendation within the approved direction, not a new purchase flow.

Place usage and included features after the renewal action. Preserve the current responsive card layout, centered Monthly/Annual pill and Upgrade comparison. The existing plan selectors continue to control plan comparisons, not the cadence of this renewal action.

Use **Renewal off** as a neutral status. Paid access remains available through the displayed end date. Avoid an ACTIVE badge beside a second cancellation statement.

### After confirmation

While the provider result is unresolved, show **Checking renewal** and keep the known access-end date visible. Disable repeat submission and keep a way to check status. Do not promise renewal from a button click, redirect or successful HTTP response alone.

After provider verification and authoritative reconciliation, show **Renews October 12, 2027** and the verified renewal price. The next renewal may still use a valid remaining discount. Turning renewal on neither restarts a used offer nor removes a valid current offer.

### Payment history

Move first-year paid amount, subtotal, tax wording and coverage dates into a separate **Payment history** section below the current-plan card. Keep these values distinct: the example paid $64.20 for a $60 first-year subtotal, while renewal is $100/year before tax.

Retain an explicit **View invoices and receipts** action through the existing payer-checked Stripe portal. Do not invent an invoice URL, build an invoice browser, or expose another server's payment history. Server managers retain their existing summary visibility; only the original payer can enter that billing account's portal.

### Other states

| State                                                                     | Current plan and action                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renewal already on                                                        | Show the verified renewal date and rate. A repeated confirmation does not toggle it off.                                                                                                  |
| Scheduled cancellation, original payer with verified terms                | Paid Basic/Pro, **Renewal off**, date and rate, **Turn renewal back on** primary.                                                                                                         |
| Another server manager                                                    | Show known plan and renewal-off date. Explain that the original payer must manage renewal; do not offer a writable billing action.                                                        |
| Payment requires attention                                                | Preserve access under the existing entitlement policy. Route to **Manage billing** to resolve payment before direct reactivation. Do not collect an outstanding payment as a side effect. |
| Unknown renewal terms or provider read failure                            | Keep a known end date visible. Offer **Try again** and, for the payer, **Manage billing**. Do not guess a price.                                                                          |
| Custom cancellation, schedule, pending change or unsupported subscription | Show renewal off when known. Offer **Review renewal in Stripe** to the payer. Do not edit or release a schedule automatically.                                                            |
| Terminal canceled or expired, no other entitlement                        | Current plan is Free. **Get Basic again** uses the existing provider-verified terminal Checkout path and current Monthly/Annual selection.                                                |
| Complimentary or forced access                                            | Preserve the existing effective plan and its badge. Any separate Stripe renewal status must not relabel that grant or revoke it.                                                          |

A terminal subscription cannot be reactivated. A new purchase must retain the server's prior monthly and annual offer-use records. It keeps existing Checkout authorization, which may allow a new payer who manages the server. That does not grant access to the former payer's receipts. [Stripe cancellation guidance](https://docs.stripe.com/billing/subscriptions/cancel#stop-a-pending-cancellation)

## User task: keep the current paid plan

```mermaid
flowchart TD
    A[Billing or direct upgrade link] --> B[Sign in and verify server access]
    B --> C[Show verified renewal-off terms]
    C -->|Simple subscription and payer| D[Turn renewal back on]
    D --> E[Verify same subscription and reconcile]
    E -->|Confirmed| F[Billing: renewal date and price]
    E -->|Unknown| G[Check the same operation]
    G --> E
    C -->|Unsupported or payment problem| H[Stripe review]
    H --> C
    F --> I[Return to server task]
```

### User task: buy again after the subscription ended

```mermaid
flowchart TD
    A[Billing or direct upgrade link] --> B[Sign in and verify terminal state]
    B --> C[Free with Get Basic again]
    C --> D[Existing Checkout]
    D --> E[Verify paid entitlement]
    E --> F[Return to server task]
```

Current behavior offers only general Stripe management. The proposed in-app action covers simple renewals. Broader plan switching and editable schedules remain owned by the existing billing initiative and are not prerequisites for this narrow action.

## Provider route and boundaries

### Selected candidate

Use the pinned `2026-07-29.dahlia` API and preserve the subscription's billing mode. For the classic boolean representation, the candidate update clears `cancel_at_period_end`. For the flexible dated representation, it clears `cancel_at`. Request no prorations. Do not supply prices, items, quantities, discounts, a new anchor or a payment request.

Stripe documents portal reactivation before the paid period ends and distinguishes flexible `cancel_at` from classic `cancel_at_period_end`. The installed SDK also permits clearing the dated field. This establishes an available candidate, not native acceptance for Chronote. [Stripe portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal#webhooks)

The subscription `/resume` endpoint is for paused subscriptions and is not this action. Hosted deep links offer cancellation and plan-update flows, but no documented focused renewal-reactivation flow. A general portal session remains the fallback; do not disguise a plan update or new Checkout as renewal. [Paused-subscription resume](https://docs.stripe.com/api/subscriptions/resume), [portal flows](https://docs.stripe.com/customer-management/portal-deep-links)

### Direct-action eligibility

Require all of the following before issuing a consent quote and again before confirmation:

- Manage Server permission and exact original-payer metadata match. Retain server/customer/subscription association and environment checks.
- A Stripe-backed active paid subscription with one supported licensed monthly or annual item and quantity one.
- A future cancellation matching the independently verified paid-service boundary. Comparing `cancel_at` only to current item period end is insufficient, because custom cancellation can shorten that period.
- No schedule, pending update, pause, trial, unresolved payment, unsupported price or uncertain cancellation ownership.
- A read-only Stripe preview with cancellation removed that verifies the same renewal boundary, recurring rate, discount lifecycle and tax basis. Reject unexpected pending or proration lines. No preview request may persist an invoice or attempt payment.

Use the existing verified invoice/service-period evidence to check the paid boundary. If independently funded service from future switching cannot yet be interpreted, route that subscription to Stripe review rather than treating its zero-cash application invoice as its service value.

The direct action has a separate default-false `STRIPE_RENEWAL_REACTIVATION_ENABLED` gate. Do not enable all plan transitions merely to expose renewal. Turning this gate off prevents update calls, including retries, while allowing reads and reconciliation of an already submitted operation. Uncertain operations remain available for review; the toggle never treats them as failed or releases their control by expiry.

### Renewal terms

The quote binds the next service date, tier, cadence, currency, quantity, recurring service rate, discount identity/end, regular rate after the discount, tax behavior and source subscription state. Bind the server and payer too. Quotes last five minutes, a proposed engineering default.

The example's `$100/year before tax` is valid only for a verified exclusive-tax rate. For inclusive pricing, say tax is included. An unspecified or unverifiable tax basis routes to provider review. Do not relabel an inclusive catalog price as before tax to match the sample copy.

Display recurring service terms, not an unsupported prediction of next year's final cash amount. Existing account credit or debt can affect a later invoice; neither is charged, refunded or reset by reactivation. Valid remaining monthly discount terms must include their actual end and subsequent regular rate. No quote grants or reserves another introductory offer.

### Consent, duplicates and recovery

Use a signed, purpose-bound five-minute quote and a durable operation keyed by its nonce. Reuse the existing consent-token codec with a renewal-specific schema and a domain-separated key derived from the configured session secret. A signature alone does not make a quote single use.

Store renewal operations and a per-server control record under distinct namespaced keys in the existing GuildSubscription table, following the purchase repository's conditional-write pattern. Do not overwrite its subscription, purchase-control or offer-ledger records. The operation records the exact request body, immutable Stripe idempotency key, approved terms and source fingerprint.

Before calling Stripe, atomically claim the server control against the saved subscription ID/revision, recheck permissions and read the native source again. A changed date, price, discount, schedule, payment state or subscription identity requires fresh review. Serialize Chronote reactivation requests; do not introduce a customer-wide lock.

After the update, independently re-read the native subscription and run existing authoritative reconciliation. Success requires cancellation removed, identical subscription/item/customer/mode, unchanged price/quantity/discount/anchor/paid period, matching approved renewal terms, and persisted current state. Offer-use records remain untouched. A lost response or failed persistence remains **Checking renewal**, with the same operation available for recovery.

Retry a submitted request only with its original body and idempotency key, for at most 23 hours after the first attempt. This conservative limit stays within Stripe's documented API v1 retention of at least 24 hours. Beyond it, use readback and review without another update. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) Never reissue a completed operation after the user later cancels again. Do not expire an unresolved operation merely because its consent quote expires. The same quote cannot start a new operation.

Chronote cannot compare-and-swap an external Stripe edit with this update. Fresh preflight plus readback narrows that race but does not eliminate it. If post-write terms or ownership drift, show **Renewal needs review**, display only freshly verified facts and route to Stripe/support. Do not claim the approved renewal succeeded, silently create a purchase, change the price back or recancel another actor's decision. Native race proof is a release condition; an unbounded or charge-producing case blocks the direct route.

## Proof and release conditions

Implementation acceptance needs all of the following. This document does not claim these tests ran.

1. Local service/repository/API tests prove authorization, quote expiry/tampering, both cancellation representations, unrelated server isolation, stale terms, duplicate submission, lost responses and current-state reconciliation.
2. Storybook and Playwright cover renewal off, confirmed renewal, processing, provider failure, nonpayer, payment problem, unsupported schedule and terminal Free. Capture and visually review desktop 1280px, intermediate 768px and mobile 390px. Assert the actual modal or page scroll container moves when overflow exists. Preserve the approved plan selectors/comparison.
3. Separately authorized Sandbox fixtures prove the exact API update for classic and flexible modes. Preserve the same subscription/item, paid-service boundary, anchor, rate, discount, customer balance and offer use, with no new invoice, payment intent, charge or proration caused by the undo. Advance a test clock to the legitimate renewal and verify normal billing.
4. Include annual introductory history renewing at regular price, a valid remaining monthly discount, repeated requests, cancel-again after success, provider timeout, concurrent native edits, payment problems and custom/schedule exclusion. Record request and effective response API versions. Use new owned fake-money fixtures, never the already cleaned parent test subscription, and reconcile cleanup.
5. Read-only native portal/configuration review must confirm the advertised fallback is actually available. An unsupported schedule may require support; the UI must not promise that Stripe can edit every schedule.
6. Public docs, focused checks, screenshots and review must pass before merge readiness. Deployment and activation remain separate decisions. Disabling the new direct-action gate must not abandon in-flight recovery.

## Decisions and review status

Approved: renewal-off hierarchy, direct primary action with authoritative terms, payment history separation, same-subscription restoration, terminal Free/repurchase, and existing offer rules.

Recommended engineering choices: direct minimal update for simple active subscriptions; inline consent; five-minute signed quote; narrow durable operation; separate default-false gate; provider review for unsupported states. These keep the approved UX small while making uncertain outcomes visible. The builder may choose internal helper layout but may not relax these behavioral constraints.

No additional pricing or eligibility decision is requested. The provider proof can invalidate the direct candidate. If it does, return with the observed mismatch rather than substituting a different billing flow or weakening consent.

## Evidence appendix

- Source inspected: `src/frontend/pages/Billing.tsx`, `src/frontend/components/SubscriptionDetails.tsx`, `src/frontend/pages/UpgradePlans.stories.tsx`, `src/frontend/pages/basicIntroFixtures.ts`, `src/frontend/utils/billingManagement.ts`, `src/trpc/routers/billing.ts`, `src/services/billingService.ts`, `src/services/subscriptionReconciliation.ts`, `src/services/subscriptionPaymentProgress.ts`, `src/utils/stripeCancellation.ts`, `src/utils/consentToken.ts`, `src/repositories/purchaseAttemptRepository.ts`, `src/services/stripeClient.ts`.
- Current local source: `20b038b8d6d40fe0a198ff06ca61c9e7b842fff4`, branch `codex/plan-switching`, based on merged `3e3981968955a82e06f2d4544b3c3dec6a8b76a2`. Follow-up source commits are local, not deployed claims.
- Current synthetic story: `pages-upgradeplans--intro-subscriber-canceled`. The date is `2027-10-12T12:00:00Z`; the fixture has USD 10000 yearly regular rate, USD 6000 initial subtotal and USD 6420 initial payment. Its DTO boolean does not establish a native Stripe cancellation representation.
- Installed SDK declarations: `node_modules/stripe/cjs/resources/Subscriptions.d.ts` and `Invoices.d.ts` accept an empty dated cancellation in update/preview parameters. Native compatibility must still be proven.
- The supplied screenshot is a synthetic Engineering HQ reference, not an active production customer or permission to modify billing. No private provider/account identities belong in this product document.
