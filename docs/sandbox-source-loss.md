# Sandbox recovery after source loss

The separate source-loss executor restores availability using the existing candidate when the original serving task has stopped. It leaves lost-owner settlement pending and ordinary deployments blocked. The healthy-source continuation keeps its original refusal checks.

## Execution boundary

Use the existing Sandbox Deployment Identity workflow on an independently reviewed source commit. Select `continuation_action=inspect-source-loss` first. This performs metadata reads and prints the frozen binding checksum. Retain the private operation packet and compare the original deployment, source, surviving candidate, generation, image, immutable task definitions, billing flags and routing topology.

After reviewing the fresh packet, select `continuation_action=recover-source-loss` with `continuation_binding_sha256` set to that checksum. The existing `sandbox` environment approval and deployment concurrency group apply. Workflow reruns, mixed bootstrap operations and missing checksums refuse before role assumption. Use a new workflow run, never replay an uncertain operation.

Stopped-task records have a limited provider retention window. If the exact source lookup becomes `MISSING`, this executor is unavailable and a separately reviewed procedure is required. Historical receipts do not replace the fresh native check.

The executor verifies the actual OIDC session and Sandbox account/resource route. It requires native `STOPPED` for the exact source task. `MISSING`, a stale heartbeat or an empty target group alone cannot substitute. The service must have one exact protected, ready candidate, no pending replacement, an empty source group, and the original acknowledged source listener action. The immutable candidate definition must retain Stripe test mode and disabled intro-offer, subscription-transition and renewal-grace gates. Existing renewal-reactivation configuration is included in the reviewed binding and remains unchanged.

Admission and the durable receipt commit atomically through conditional DynamoDB operations. The candidate must then publish its own fresh heartbeat and readiness at the new generation. Routing uses the existing submitted-request fence, one listener call, and exact acknowledgment. Authority, native identities, protection, target health and the expected source listener action are checked again before submission.

This path cannot build or launch an image, register a definition, stop a task, release protection, clear a lease or voice guard, or replay an external effect. A receipt from any prior attempt blocks another execution. Preserve its state for separately reviewed reconciliation.

## Availability is separate from settlement

The operator receipt uses `SOURCELOSS#<originalRunToken>` / `RECOVERY` in DeploymentControlTable. It has no TTL. Runtime point readers and the existing `ENV` runtime query do not read this partition. The strict runtime record union and Control phases are unchanged.

The receipt progresses through `admission_transferred`, `forward_submitted` and `availability_restored`. Its settlement remains `lost_owner_settlement_pending`, with reason `incomplete_durable_effect_ledger`. No automatic `source_loss_settled` transition exists. The original deployment stays `promoting` or `promoted`; its source runtime receives no fabricated retirement acknowledgment.

Metadata scans retain source-attributed claims, history dispositions, processing claims and voice guards, with complete pagination. The receipt records that dated snapshot. Scans exclude meeting content and raw command result/error bodies. Empty scans cannot recover the stopped runtime's in-memory effect acknowledgments. Completed personal processing can also precede ancillary export. Each scan is bounded to 100 pages of 100 items and at most 100 source-owned rows per table. Larger or incomplete results refuse recovery. The snapshot records its collection time and may precede the fresh admission inspection; it is observational and does not authorize settlement.

The deploy role lacks reads for some ancillary ledgers; expanding that role would not reconstruct the lost evidence.

An unknown listener result leaves `forward_submitted` unresolved. Intended weights observed later do not authorize another listener request or completion. A lost DynamoDB response can be accepted only through exact readback of the atomic Control and receipt state.

## Operator acceptance

The billing owner verifies the exact candidate image serving through the acknowledged listener, healthy targets, HTTP 200 health/readiness, native protection, Dev bot identity and Stripe test mode before resuming the approved billing tests. Source CI alone proves none of those hosted outcomes. Preserve all unresolved source work and guards under their existing fenced recovery protocols.

The deferred voice retest and paused recording watch remain separate. Production recovery is outside this executor's scope.

Deterministic refusals and race tests live in `test/scripts/sandboxSourceLoss.test.js`. Native DynamoDB transaction and preserved-guard tests live in `test/deployment/sourceLoss.integration.test.ts`. The observer reports availability-restored and settlement-pending receipt counts separately.
