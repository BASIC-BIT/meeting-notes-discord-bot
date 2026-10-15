# Bootstrap an existing Sandbox runtime

The normal deployment coordinator requires an already compatible serving runtime. Use the guarded bootstrap only for the separately reviewed first introduction in Sandbox, during its controlled maintenance window. It does not stop legacy tasks, register definitions, change listener actions, apply Terraform or create monitoring jobs.

Keep exact environment identities, operator receipts, manifests and observations in the private operations repository. Never commit real resource or Discord identifiers in this public reference.

## Prepare the operation

Use the private activation plan to settle the current work and establish test-only maintenance isolation. Apply the reviewed Sandbox Terraform artifact through its existing approval gate. Verify the two-group routing introduction with group A at 100 and group B at zero, no stickiness or extra rules, both groups empty and the service stopped.

Register the reviewed candidate definition through the existing deployment authority, exactly once, with an acknowledged provider receipt. It must:

- Pin its image as `repository@sha256:digest`.
- Set `stopTimeout: 120` on the selected container.
- Use the explicit Node command for its runtime mode: `["node", "dist/index.js"]`, `["node", "dist/apps/bot/main.js"]` or `["node", "dist/apps/api/main.js"]`.
- Set exactly one `DDB_TABLE_PREFIX` and one `DEPLOYMENT_CANDIDATE_ID`, matching the manifest prefix and operation UUID.
- Set exactly one literal `TRANSCRIPTS_BUCKET` matching the manifest bucket. Missing, different or duplicate values and secret overrides refuse launch.
- Retain reviewed environment and native secret references for credentials. Do not extract or copy secret values.

The bootstrap will not retry registration or reconstruct an unacknowledged registration outcome.

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

Compute the checksum over the parsed JSON using `manifestHash` from `scripts/deployment/sandbox-manifest.cjs`. It hashes `JSON.stringify(parsedManifest)`, preserving key order. Editing the manifest, including its operation identity, requires a new reviewed checksum. There is no implicit environment-file loading or endpoint override support.

## Run each phase explicitly

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

The collector uses only read operations. It validates the same account/principal bindings, paginates explicit DynamoDB metadata projections and excludes transcript, notes body, context, prompts and delivery-error text. Output contains aggregate signals, not user content. An incomplete scan or read failure reports observation unavailable, never an empty healthy result.

The window must end no later than now and span at most 24 hours. Keep the activation baseline and exact source/digest bindings with each private receipt. Requested flags, transcription/notes/summary results and each delivery outcome remain separate. Unknown and not-applicable outcomes are counted separately from failure. Stale-record candidates are investigation signals, not canonical failure or lost-audio classifications. Runtime and routing snapshots do not prove all provider operations have settled.

Use the native task heartbeat for the approved post-activation schedule, not a repository cron or newly installed service. Create it only after actual activation bindings and time are known. Verify its read access, retain the ID in the private owner note, check every 15 minutes through the bounded 24-hour window, notify only on meaningful changes and stop at the end. No watcher is started by either command.

Simultaneous multi-server admission and crash recovery remain NOT_OBSERVED unless ordinary activity and separately reviewed metadata establish them. A quiet observation window is not proof of unexercised correctness. Live Notion acceptance, deliberate faults, historical repair and completed-object deletion remain separate.
