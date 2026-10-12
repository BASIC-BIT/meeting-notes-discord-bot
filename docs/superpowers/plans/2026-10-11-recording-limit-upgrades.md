# Recording-limit upgrade paths implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task. Preserve the progress ledger and run a fresh whole-branch review before delivery.

**Goal:** Give recording-limit interruptions a truthful, server-specific next action and measure the complete upgrade journey.

**Architecture:** Reuse subscription, usage, interaction-receipt, Discord delivery and purchase-attribution patterns. Add one recording-specific notice service; existing Ask/TTS helpers keep their current behavior. Carry a validated two-enum context through the existing purchase attempt rather than adding identifiers or a new storage schema.

**Tech Stack:** Node 24, TypeScript, discord.js, React/Mantine, Jest, Playwright, Storybook and PostHog.

**Spec:** Private approved design: https://github.com/Chronote-gg/chronote-ops/blob/main/strategy/recording-limit-upgrade-path.md. Local copy: D:/bench/chronote-ops/strategy/recording-limit-upgrade-path.md.

## Global constraints

- Free recording pressure can lead to Basic when its actual allowance helps. Existing billing uses management; no plan removes the two-hour session cap.
- Preserve finalization, active leases, access checks, existing subscription-transition guards, DNT, immutable initial-purchase attribution and webhook deduplication.
- Preserve only guild and actor identifiers in PostHog. Fixed enums/counts are allowed; no content, provider IDs, message/channel IDs, raw URLs or errors.
- Manual refusals always respond. Identical auto refusals have a 15-minute receipt; definite failed delivery releases only its own receipt, unknown delivery retains uncertainty until expiry.
- Duration and weekly limits on one recording retain both encounters but use one recovery message, updated after weekly calculation. A duration notice suppresses a later near-warning.
- Public privacy notice and What's New ship before expanded production capture. Production remains separately authorized; Sandbox authority is standing.

## Review focus

- Billing lookup failure never infers Free or grants access; useful recording-limit facts still appear.
- An entitlement change while recording does not sell an allowance the server now has or silently extend its timer.
- A failed/unknown Discord send cannot block finalization or be counted as delivered.
- A legacy Stripe pointer is management, never an eligible initial-purchase denominator.
- Invalid/partial URL context and DNT cannot leak arbitrary properties or change immutable checkout attribution.

## Task 1: Bounded context and provider attribution

**Files:** src/utils/purchaseAnalytics.ts; src/trpc/routers/billing.ts; src/services/billingService.ts; src/services/initialPurchaseService.ts; src/api/billing.ts; src/frontend/services/analytics.ts; test/services/initialPurchase.test.ts; test/trpc/billingRouter.test.ts; existing billing/webhook/analytics suites; new test/utils/recordingLimitContext.test.ts.

**Interfaces:** Export RECORDING_LIMIT_TYPES (weekly_recording, meeting_duration), RECORDING_LIMIT_SURFACES (manual_start, auto_start, duration_stop, weekly_after_meeting, weekly_warning, mcp_start), RecordingLimitContext, resolveRecordingLimitContext(input), and recordingLimitAnalytics(input). A context is usable only with both valid, compatible fields. Backend checkout adds optional typed limitType/limitSurface. Metadata keys are recording_limit_type and recording_limit_surface; analytics keys are limit_type and limit_surface.

- [ ] Write red tests for valid/invalid context, backend parsing, initial-attempt context/return preservation, frozen retry attribution, paid webhook context, DNT and raw/encoded/nested URL redaction.
- [ ] Run relevant tests, confirming assertion failures for missing behavior rather than broken fixtures.
- [ ] Implement the shared context parser and propagate it through new-checkout URLs and metadata. Capture checkout from the frozen attempt, not the retry's new parameters. Preserve original subscription attribution for renewals/plan changes.
- [ ] Pass focused context, billing/router/attempt/webhook and analytics tests; run TypeScript.
- [ ] Commit the task and record exact tests/results in the ledger.

## Task 2: Consistent recording-limit responses

**Files:** new src/services/recordingLimitService.ts and test/services/recordingLimitService.test.ts; src/commands/startMeeting.ts; src/commands/endMeeting.ts; src/meetings.ts; src/types/meeting-data.ts; targeted receipt release in src/db.ts; existing start/end/meeting timer and receipt suites.

**Interfaces:** RecordingLimitInput includes validated context, guild/optional actor, outcome (blocked_start, ended_session, exhausted_after_meeting, near_limit), observed limit/used minutes and recovery time. encounterRecordingLimit(input) resolves notice payload/decision and captures actual pressure. deliverRecordingLimitNotice(notice, send-or-edit operation) captures accepted/failed delivery. notifyRecordingLimit(input, channel, recording-local state?) coordinates suppression/consolidation. Existing response type gains optional typed recordingLimitNotice for the manual wrapper; MCP keeps its existing error contract and only records the shared encounter.

- [ ] Write red policy/delivery tests: Free -> Basic, Basic weekly -> management, two-hour neutral, legacy pointer, grants/forced state, disabled/failed billing, captured cap after entitlement change, suppressed auto repeats, failure/unknown send, combined timeout+exhaustion and timeout+near suppression.
- [ ] Run the tests and confirm expected failures.
- [ ] Implement a pure payload decision inside the targeted service. Bound asynchronous eligibility reads; builders alone never capture. Reuse the existing receipt schema and conditional claim; release only a definitely failed delivery's own reservation.
- [ ] Replace only recording call sites. Store the notice send promise/message reference on MeetingData runtime state for deterministic timeout/weekly consolidation. Invoke onTimeout before asynchronous notice resolution; catch notification failures and preserve finalization.
- [ ] Add integration regressions proving manual/auto actions, shared MCP capture, timer stopping before failed lookups, exact once timeout capture, normal save/cleanup, and preserved Ask/TTS helpers.
- [ ] Pass focused notice/start/end/timer/helper tests and TypeScript, then commit and ledger.

## Task 3: Purchase UI, public notice and acceptance

**Files:** src/frontend/router.tsx; src/frontend/pages/UpgradeServerSelect.tsx; src/frontend/pages/Billing.tsx; current purchase/billing stories and tests; test/e2e/billing.spec.ts; docs/purchase-analytics.md; apps/docs-site/docs/legal/privacy.md; existing What's New registry/docs; reviewed AGENTS.md/README.md/copilot guidance where a factual correction is necessary.

**Interfaces:** Router accepts optional enum limitType/limitSurface. Purchase/Billing reuse resolveRecordingLimitContext and recordingLimitAnalytics. Billing source is retained when supplied; normal Billing entry still defaults portal_billing. billing_entry_arrived is once per mounted, resolved server entry; readiness is not fabricated on Billing.

- [ ] Write red UI/browser tests proving server/context survives authentication, cancellation, interval and server recovery, both direct plan actions remain guarded, Billing retains its source/context, and invalid context is excluded from analytics.
- [ ] Implement a short contextual explanation on existing purchase/Billing pages and preserve context in URL intent and mutation inputs. Keep non-manager intent and existing guarded recovery; create no new page.
- [ ] Update public privacy overview/details/provider row/date and What's New, plus the engineering event contract and proposed seven-day/24-hour cohort definitions. Keep provider-portal expansion attribution explicitly unknown.
- [ ] Pass focused tests, type/lint/format/docs checks; run full Jest and relevant browser checks. Add/update stories, capture Storybook screenshots, review them and page snapshots with the VLM. Update only deliberate context-banner snapshots.
- [ ] Fresh whole-branch review; fix valid blocking findings with red/green coverage. Push a PR, attach it and audit exact-head checks/reviews. The 30-minute post-commit readiness gate remains binding.
- [ ] After human merge, Sandbox deployment and controlled refusal/timeout/checkout/event-row acceptance with test-only cleanup. Production and paid PostHog changes remain separate. Saved dashboard views follow captured event acceptance, with exact definitions and private evidence links.

## Pre-flight and delivery

Task 2 and Task 3 consume Task 1's context parser and analytics projection. No caller invents new names. Optional context fields are additive to existing attempts; old metadata stays valid. No dependency installation, pricing change, live timer extension or private customer content is needed.

This engineering plan implements the approved scope. It does not replace the private strategy or claim deployed acceptance.
