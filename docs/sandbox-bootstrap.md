# Bootstrap an existing Sandbox runtime

The normal deployment coordinator requires a compatible serving runtime. For the first Sandbox introduction, use the manual **Sandbox Deployment Identity** workflow with explicit `prepare` and `activate` phases during the approved maintenance window. Its default `bootstrap_phase: none` remains a read-only identity check.

The preparation phase publishes a source-pinned image and registers its definition without replacing the service. Activation owns the one-time legacy stop and listener transition, then calls the existing bootstrap initializer, launcher and promotion transaction. It does not apply Terraform or create monitoring jobs.

Keep exact environment identities, operator receipts, manifests and observations in the private operations repository. Never commit real resource or Discord identifiers in this public reference.

## Prepare the operation

1. Apply and verify the reviewed Sandbox Terraform artifact through its existing approval gate. Keep the legacy service running at desired/running one with no pending task, bound only to group A. Keep the HTTPS listener in its legacy single-target form, pointing at group A with no extra rules or stickiness. Both AWS response forms are accepted: `TargetGroupArn` alone, or that field accompanied by a one-group `ForwardConfig`. Group B must be empty. Do not stop the service or install weighted routing manually before dispatching activation.
2. Select a reviewed source and unique operation UUID. Dispatch the workflow from that exact source with `bootstrap_phase: prepare` and `bootstrap_operation_id`. Verify the acknowledged candidate definition and pinned image digest through provider readback. An unknown registration outcome requires reconciliation, not another attempt. The job refuses a second definition for the same candidate UUID.
3. Establish fixture-only maintenance isolation and settle all work. Empty work scans alone cannot establish isolation. The first-activation wrapper conservatively requires empty lease, command and personal-job tables and terminal complete/cancelled histories. Preserve stale or ambiguous records. Record the separate input-isolation proof, exact source/resources and generated-fixture scope in the private packet.
4. Prepare and review the private manifest below, using the acknowledged candidate definition and digest. Bind its `principalArn` to the Sandbox deployment role's exact activation session, `chronote-sandbox-<decimal value of the UUID without hyphens>-1`. Put the JSON in the Sandbox environment secret `SANDBOX_BOOTSTRAP_MANIFEST`. Supply its checksum and the same operation UUID to `bootstrap_phase: activate`. The manifest source must match the workflow source. Dispatch once, not a workflow rerun.

The candidate definition must remain ACTIVE and:

- Pin its image as `repository@sha256:digest`.
- Set `stopTimeout: 120` on the selected container.
- Use the explicit Node command for its runtime mode: `["node", "dist/index.js"]`, `["node", "dist/apps/bot/main.js"]` or `["node", "dist/apps/api/main.js"]`. The workflow preparation mode currently prepares the combined `all` runtime.
- Set exactly one literal `DDB_TABLE_PREFIX` and one literal `DEPLOYMENT_CANDIDATE_ID`, matching the manifest prefix and operation UUID. Same-named secret references refuse launch.
- Set exactly one literal `TRANSCRIPTS_BUCKET` matching the manifest bucket. Missing, different or duplicate values and secret overrides refuse launch.
- Retain reviewed environment and native secret references for credentials. Do not extract or copy secret values.

## What activation does

The workflow rechecks the exact STS identity, source/operation/checksum binding, candidate digest under the source commit ECR tag, prepared definition, legacy service, work tables, listener and full target-group configuration before any shutdown. The spare must be unattached; both groups must have the expected VPC, IP target type, protocol, port, health path and disabled stickiness. A conditional `INTRODUCTION` receipt reserves the operation while Control is absent. Durable submitted intent precedes each service or listener write.

It submits desired zero once, waits for every legacy task to be STOPPED and both groups to have no targets including draining, then rechecks work and the unchanged listener. It introduces A100/B0 weighted routing with disabled stickiness once and requires acknowledgment plus exact readback. Initialization atomically verifies the same routing-acknowledged introduction receipt while creating Control and the bootstrap receipt.

The existing bootstrap then launches the pinned candidate. A read-only preflight polls the exact live task registration, fresh readiness, native protection and ALB health before the single promotion attempt, with a 15-minute warmup deadline. Expired or replaced task rows do not substitute for the current live task. Promotion revalidates these conditions before its conditional transaction. A fresh serving heartbeat from the exact promoted Control member completes the introduction. Keep maintenance in force until these checks and the approved generated-recording acceptance succeed. Use the normal coordinator for subsequent compatible handoffs.

Unknown provider acknowledgments preserve submitted receipts and refuse replay, reversal and promotion. A readiness timeout after shutdown can leave Sandbox down. Keep maintenance in force and reconcile manually; do not clear ownership or assume the old image can read checkpoint-bearing histories. Use only a proven compatible fallback or repair forward.

## Manifest contract

The private JSON supplies these exact fields. No field has a production default.

| Fields                                                         | Values                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `environment`, `accountId`, `region`, `principalArn`           | Literal `sandbox`, exact account/region and exact non-root deployment user or assumed-role session ARN |
| `operationId`, `sourceCommit`, `imageDigest`                   | Unique UUID, reviewed full source commit and pinned SHA-256 image digest                               |
| `cluster`, `service`, `containerName`, `tablePrefix`, `bucket` | Explicit Sandbox resources, prefix ending in a hyphen                                                  |
| `legacyTaskDefinition`, `taskDefinition`                       | Exact distinct legacy and prepared candidate revision ARNs in the bound account/region                 |
| `runtimeMode`, `containerPort`                                 | `all`, `bot` or `api`; exact selected container port                                                   |
| `listenerArn`, `targetGroupA`, `targetGroupB`                  | Exact associated HTTPS listener and distinct Sandbox IP target groups                                  |
| `maintenance`                                                  | `testOnly: true`, `workSettled: true`, operator evidence `receiptSha256` and UTC `confirmedAt`         |

Maintenance attestations describe the reviewed operator procedure. They do not replace provider checks or prove no content was lost. Initialization also checks that the service is at desired/running/pending zero, all discovered legacy tasks are stopped, the groups and Control table are empty, and no nonterminal or live active lease remains. Old ambiguous lease state causes refusal, not automatic cleanup. The maintenance receipt must be no older than 15 minutes at initialization.

Compute the checksum over the parsed JSON using `manifestHash` from `scripts/deployment/sandbox-manifest.cjs`. It hashes `JSON.stringify(parsedManifest)`, preserving key order. Editing the manifest, including its operation identity, requires a new reviewed checksum. There is no implicit environment-file loading or endpoint override support. Child calls ignore shared-config endpoint URLs and refuse explicit endpoint environment overrides.

## Low-level phases for reviewed reconciliation

The workflow is the normal first-activation entry point. The commands below are lower-level components for an explicitly reviewed continuation after provider state and ownership have been reconciled. They do not stop legacy tasks, register definitions or introduce routing. Their initialization preconditions require those transitions to be complete. Never mix them into a running or ambiguous workflow operation.

Build the backend protocol builders first with `yarn build`. Use the exact reviewed manifest and checksum for every phase:

```text
node scripts/deployment/bootstrap-sandbox.cjs dry-run --manifest PRIVATE_FILE --sha256 REVIEWED_HASH
node scripts/deployment/bootstrap-sandbox.cjs initialize --manifest PRIVATE_FILE --sha256 REVIEWED_HASH
node scripts/deployment/bootstrap-sandbox.cjs launch --manifest PRIVATE_FILE --sha256 REVIEWED_HASH
node scripts/deployment/bootstrap-sandbox.cjs promote --manifest PRIVATE_FILE --sha256 REVIEWED_HASH
```

Dry-run performs no provider calls and prints identity verification as UNKNOWN.

Initialization atomically creates empty ECS Control and its operation receipt. Existing foreign Control or ownership cannot be adopted. Exact prior initialization can be read back without another write.

Launch verifies the prepared definition and empty topology, claims a unique durable launch attempt, then submits one UpdateService call. All CLI calls force one total attempt. Concurrent invocations cannot both launch. If the provider response is lost, matching readback does not permit another submission or promotion. Preserve the submitted receipt for operator reconciliation.

Promotion requires one exact live candidate task, matching image, its own runtime registration, fresh dependency/cache/gateway readiness for its mode, explicit zero work accounting, native protection beyond the safety margin and the exact healthy target. It uses the existing conditional promotion transaction with empty expected membership. The same transaction completes the operation receipt and releases coordinator authority. Dynamo response loss can be reconciled from exact Control, runtime and receipt readback.

The bootstrap lease lasts 30 minutes. Expired or changed ownership refuses progress. There is no reset, force-unprotect, history repair or voice-guard deletion option. A refusal returns a sanitized status without dumping provider errors or secret-bearing task definitions.

After promotion, observe a fresh serving heartbeat and complete a generated recording in the selected existing test server. Then use the normal coordinator for the single-server handoff and subsequent new-start checks. The bootstrap alone does not create completed-deployment lineage for compatible crash replacement.

## Collect bounded observations

```text
node scripts/deployment/observe-sandbox.cjs --manifest PRIVATE_FILE --sha256 REVIEWED_HASH --since UTC_ISO_START --until UTC_ISO_END
```

The collector uses only read operations. It validates the same account/principal bindings, paginates explicit DynamoDB metadata projections and excludes transcript, notes body, context, prompts and delivery-error text. Output contains aggregate signals, not user content. CLI calls disable automatic pagination so the explicit collector loops control page bounds. An incomplete scan or read failure reports observation unavailable, never an empty healthy result.

The window must end no later than now and span at most 24 hours. Keep the activation baseline and exact source/digest bindings with each private receipt. Requested flags, transcription/notes/summary results and each delivery outcome remain separate. Unknown and not-applicable outcomes are counted separately from failure. Stale-record candidates are investigation signals, not canonical failure or lost-audio classifications. Interrupted records with completed recovery are settled; failed, pending and reconciliation states remain visible in the recovery disposition counts. The history window selects the cohort; `collectedAt` dates the current lease, runtime, protection and queued-control snapshot. Expirations and stale-progress checks use collection time. Recovery reconciliation counts remain separate from the delivery-uncertain subset. Unfinished bootstrap receipt stages also count as incomplete deployments. Runtime and routing snapshots do not prove all provider operations have settled.

Use the native task heartbeat for the approved post-activation schedule, not a repository cron or newly installed service. Create it only after actual activation bindings and time are known. Verify its read access, retain the ID in the private owner note, check every 15 minutes through the bounded 24-hour window, notify only on meaningful changes and stop at the end. No watcher is started by either command.

Simultaneous multi-server admission and crash recovery remain NOT_OBSERVED unless ordinary activity and separately reviewed metadata establish them. A quiet observation window is not proof of unexercised correctness. Live Notion acceptance, deliberate faults, historical repair and completed-object deletion remain separate.
