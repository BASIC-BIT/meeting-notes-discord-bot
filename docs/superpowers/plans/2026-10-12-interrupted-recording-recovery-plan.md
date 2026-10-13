# Interrupted recording recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve verified recording segments during capture and automatically deliver truthful partial notes after interruption without publishing stale-owner output or guessing missing audio.

**Architecture:** Reuse audio capture, S3 and history storage. Immutable segment uploads precede versioned manifest publication; capture stops after bounded preservation retries. Bounded shutdown and a serving-runtime recovery worker use the [handoff plan's](2026-10-12-deployment-handoff-plan.md) generation/ownership protocol. Interrupted capture status stays visible after successful partial-note generation.

**Tech Stack:** Node.js 24.15.0, TypeScript, existing audio/ffmpeg and AWS SDK v3 storage, DynamoDB, Jest, Storybook and Playwright.

**Spec:** [Approved deployment and interruption design](../specs/2026-10-12-deployment-drain-and-interruption-design.md).

## Global constraints

- Subagent-driven implementation and review are authorized. Use the main plan's worktree, authority, privacy, review and version constraints. No production repair, customer-content retrieval or deployment.
- Automatic partial notes are agreed, provided saved speech is usable and original transcription/notes settings requested them. No usable speech gets a truthful notice and skipped outcome, not invented notes.
- Target independent segment closure every 30 seconds maximum; stop capture after 60 seconds without confirmed preservation; shutdown preservation budget 100 seconds within stopTimeout 120. Exact timing and buffer limits need Sandbox load validation.
- Segments, transcripts, context, participants and prompts remain protected application data, never analytics/log properties. Content-bearing fixtures are generated, not copied from customer recordings.
- Object upload precedes manifest commit. Stale-owner preservation can create immutable attempt objects but cannot publish canonical manifest/history/delivery.
- Lease expiry, process/task-record absence and capture terminal status do not imply safe voice takeover, exact end time or completed processing. Partial-note delivery retains interrupted status and coverage.
- No general job framework, new queue, EFS or new dependency. Recovery resumes offline through existing processing services and never rejoins voice.

## Review focus

1. Object upload succeeded but manifest commit was lost. Recovery verifies the immutable object and does not advertise missing data. Test R1/R4.
2. Silence/long-open transcription snippets or bot audio never close a durable segment. Independent rotation still checkpoints them. Test R2.
3. SIGTERM arrives while initialization, ffmpeg or an AI call is pending. Preserve within the shared deadline without late success publication. Test R3.
4. Interrupted capture is terminal, but partial-note/delivery work is pending. It remains discoverable until its recovery disposition settles. Test R4.
5. Discord accepted a send but acknowledgment persistence failed. Mark unknown and require reconciliation instead of automatically duplicating messages. Test R4/R5.

## File responsibilities and interfaces

Create `src/types/recordingCheckpoint.ts`, `src/services/recordingCheckpointService.ts`, `src/services/meetingInterruptionService.ts`, `src/services/meetingRecoveryService.ts`, `src/services/meetingRecoveryWorkerService.ts`, `src/utils/meetingCaptureNotice.ts` and a narrowly derived `MeetingNotesInput` in `src/types/meeting-data.ts`. Reuse existing storage/history/notes/summaries services. Do not fake a VoiceConnection to invoke notes generation.

| Contract                      | Definition and owning task                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CheckpointSegment`           | R1: immutable attempt/source/sequence identity, S3 key, checksum, PCM format, timeline offsets and duration. IDs/content do not enter diagnostic output.                                                                                                                                    |
| `RecordingCheckpointManifest` | R1: schemaVersion `1`, meeting/execution attempt, committed segments, capture-start/last-confirmed coverage, complete/interrupted capture disposition and completed transcription/context checkpoint pointers. A manifest never claims an unconfirmed object.                               |
| `CaptureCoverage`             | R1: verified variant with confirmed intervals, saved duration and lastConfirmedCaptureAt, or unknown variant with detection/reason metadata. Actual stoppedAt is present only when known. Do not fill unknown saved duration with zero or detection time.                                   |
| `RecoveryDisposition`         | R1: `pending`, `claimed`, `done`, `failed`, or `needs_reconciliation`, with attempt/version, stage and bounded retry metadata. Independent of capture status.                                                                                                                               |
| `CheckpointAppendResult`      | R1: `committed`, `stale_owner`, or `preservation_failed`, with confirmed coverage only.                                                                                                                                                                                                     |
| `MeetingNotesInput`           | R4: derive the exact content/config/identity fields used by notes, prompt, attendees, model override and chat helpers from MeetingData; omit connection, audio streams, timers and end callbacks. Include interruption/coverage metadata. Live MeetingData remains structurally compatible. |

```ts
appendRecordingCheckpoint(meeting: MeetingData, segment: CheckpointSegmentInput): Promise<CheckpointAppendResult>;
flushRecordingCheckpoint(meeting: MeetingData, options: { signal: AbortSignal }): Promise<CaptureCoverage>;
interruptOwnedMeeting(meeting: MeetingData, input: InterruptionInput): Promise<InterruptionResult>;
recoverMeeting(input: RecoveryClaim, options: { signal: AbortSignal }): Promise<RecoveryDisposition>;
formatMeetingCaptureNotice(input: CaptureNoticeInput): string | undefined;
```

`CheckpointSegmentInput` carries source/sequence, offsets, format and bounded PCM bytes from live capture. `InterruptionInput` has reason enum `shutdown`, `ownership_lost`, `storage_preservation`, deadline and AbortSignal. `InterruptionResult` records durable/reconciliation-required disposition, not an assumed recovery success. `RecoveryClaim` pins history key, owner/attempt/execution version, requested settings and verified manifest reference. `CaptureNoticeInput` is complete capture, or interrupted capture with verified/unknown CaptureCoverage; legacy complete rows do not need invented coverage fields. These functions never create voice connections. Core history transitions/admission builders come from H1-H4.

## Task 1 (R1): Checkpoint schema, immutable storage and recovery metadata

**Files:** Create checkpoint types/service; modify `src/services/storageService.ts`, `src/services/uploadService.ts`, `src/types/db.ts`, `src/types/meetingLifecycle.ts`, history repository/service, `src/repositories/mockStore.ts`; create `test/services/recordingCheckpointService.test.ts`, `test/deployment/checkpointPersistence.integration.test.ts`.

**Interfaces:** Consumes H1 conditional history/ownership and `starting`, `interrupted`, `failed` statuses; produces checkpoint contracts and append/flush functions. Add capture/recovery metadata without changing old complete-row compatibility or auto-classifying legacy orphans.

- [ ] Write `uploadBeforeManifestPublish`, `duplicateSegmentIsIdempotent`, `checksumMismatchIsRejected`, `staleOwnerCannotPublishManifest`, `interruptedPendingRecoveryIsDiscoverable`, and `confirmedCoverageExcludesMissingObjects`:

```ts
expect(manifestCommitBeforeSuccessfulUpload).toBe(false);
expect(duplicateCommittedSegmentCount).toBe(1);
expect(savedDurationMsIncludingUnverifiedTail).toBe(false);
expect(interruptedPendingRow.recovery.disposition).toBe("pending");
```

- [ ] Run the checkpoint-service unit suite and `yarn test:deployment:integration --runTestsByPath test/deployment/checkpointPersistence.integration.test.ts`; confirm red on missing commit ordering/metadata. Integration fixtures use generated bytes and isolated local storage/table prefixes through H1's dedicated runner.
- [ ] Implement deterministic attempt/source/sequence keys, SHA-256 validation using Node crypto, versioned manifest CAS and checkpoint object verification. Add AbortSignal propagation to the existing storage helper rather than a parallel upload client. Preserve existing storage error behavior for other callers; checkpoint callers interpret failure explicitly. Manifest/context/transcription state needed for offline generation stays in protected S3, with pointers/shape in DynamoDB. New terminal statuses cannot default to complete in existing readers.
- [ ] Run suites plus storage/history/lifecycle regression tests and `yarn build`. Legacy unversioned nonterminal rows are left unchanged.
- [ ] Commit `feat: add durable recording checkpoint metadata`; obtain scoped review.

## Task 2 (R2): Independent capture rotation and preservation cutoff

**Files:** Modify `src/audio.ts`, `src/types/audio.ts`, `src/meetings.ts`, `src/commands/endMeeting.ts`, checkpoint/upload/temp services; create `test/audio/recordingCheckpointCapture.test.ts`; extend endMeeting tests.

**Interfaces:** Produces checkpoints from existing user/bot PCM capture, independent of transcription snippet rotation. Ordinary finalization publishes complete capture/pointers before final-pass AI or notes. Capture backlog tracks queued bytes and oldest unconfirmed age without an unbounded worker queue.

- [ ] Write `longOpenSnippetStillCheckpointsAtThirtySeconds`, `botAudioUsesSameDurableCoverage`, `silenceDoesNotClaimSpeech`, `sixtySecondsWithoutPreservationStopsCapture`, `aiDoesNotPrecedeDurableCapture`, and `uploadFailureDoesNotDeleteLocalTail`. Use fake clocks for exact boundaries and explicit unresolved upload barriers:

```ts
expect(checkpointClosureTimes.every((ms) => ms <= 30_000)).toBe(true);
expect(captureContinuesAt(60_000)).toBe(false);
expect(notesCallsBeforeCaptureCommit).toBe(0);
```

- [ ] Run capture/end suites; confirm red.
- [ ] Implement per-source PCM accumulation/rotation with existing sample-format facts. Derive the hard queue-byte bound from that source format and the 60-second unconfirmed window; account for concurrent speakers and backpressure. Stop capture and record storage-preservation interruption at cutoff; attempt a truthful notice without letting send failure block preservation. Keep a bounded local tail for retry, never label it saved until confirmed. Publish capture before expensive finalization, then continue the existing final audio/transcript delivery format.
- [ ] Run suites, generated ffmpeg decode/checksum checks and backend build. A segment’s actual duration/format determines offsets; synthetic fixtures cover overlap and gaps.
- [ ] Commit `feat: checkpoint capture before final processing`; obtain scoped review.

## Task 3 (R3): Bounded interruption and real signal handling

**Files:** Create interruption service; modify `src/bot.ts`, `src/meetings.ts`, `src/commands/endMeeting.ts`, `src/audio.ts`, runtime lifecycle service and `Dockerfile` only if necessary; create `test/services/meetingInterruptionService.test.ts`, `test/deployment/containerShutdown.integration.test.ts`.

**Interfaces:** Consumes H2/H3/H4 and R1/R2. Produces `interruptOwnedMeeting`; runtime shutdown applies one process-wide 100-second preservation budget, not a new full budget per meeting.

- [ ] Write `shutdownStopsCaptureWithoutWaitingForNaturalEnd`, `oneDeadlineAcrossConcurrentMeetings`, `pendingInitializationSettlesBeforeExit`, `encoderNeverEndsStillMeetsDeadline`, `lateAiResultCannotOverwriteInterruption`, and `databaseOutageLeavesRecoveryEligibleCheckpoint`:

```ts
expect(totalPreservationElapsedMs).toBeLessThanOrEqual(100_000);
expect(fullAiPipelineInvokedByShutdown).toBe(false);
expect(lateSuccessPublishedAfterInterruption).toBe(false);
```

- [ ] Run interruption unit tests; confirm red.
- [ ] Implement synchronous admission closure, pending-start/claim settlement, capture/voice stop, tail flush and conditional interruption history/checkpoint. Encoder finalization needs resolve/reject/deadline paths, including an encoder already ended before listeners attach. Cancel or version-fence late work. Flush telemetry and exit with remaining grace; failures do not become complete. Do not interrupt healthy old recordings merely because a candidate launch or retirement deadline failed.
- [ ] Build the real image and run `yarn test:deployment:integration --runTestsByPath test/deployment/containerShutdown.integration.test.ts` with generated audio, sending SIGTERM and hard kill only to this fixture's isolated containers. Verify Node receives signals through the launch chain; if needed replace npx/yarn wrapper with the corresponding direct Node command while preserving separate runtime modes. Expected: graceful preservation exits inside 120 seconds; hard kill yields only verified saved portions, no assumed tail.
- [ ] Commit `fix: preserve interrupted recordings within shutdown grace`; obtain scoped review.

## Task 4 (R4): Offline recovery worker and automatic partial notes

**Files:** Create recovery service/worker; modify history repository/service, `src/services/notesService.ts`, `notesPromptService.ts`, `meetingNotesService.ts`, `openaiChatService.ts`, `meetingModelOverrides.ts`, `src/utils/meetingAttendees.ts`, `src/types/meeting-data.ts`, bot/webserver runtime startup; create `test/services/meetingRecoveryService.test.ts`, `test/services/meetingRecoveryWorkerService.test.ts`; extend notes/prompt/mention tests.

**Interfaces:** Produces `MeetingNotesInput` and `recoverMeeting`. Narrow existing notes/chat helper input types to the fields they actually consume, then migrate live and recovery callers. Preserve model selection, safety identity, context, trace handling, user/role allowlists and `stripUnknownMentions`. Do not duplicate the notes pipeline or cast a disconnected object to MeetingData.

- [ ] Write `terminalInterruptedPendingWorkIsRecovered`, `liveRenewedOwnerBeatsRecoveryClaim`, `twoRecoverersProduceOneAttempt`, `oldFinalizerCannotOverwriteRecovery`, `partialSpeechGeneratesNotesWithoutVoiceJoin`, `noUsableSpeechSkipsNotes`, `uncertainDeliveryIsNotResent`, `exhaustedAttemptsClearAutomaticEligibility`, and `missingManifestCommitIsReconciled`:

```ts
expect(recoveryVoiceJoinCalls).toBe(0);
expect(historyAfterPartialNotes.status).toBe("interrupted");
expect(notesGenerationCallsForNoSpeech).toBe(0);
expect(resendCallsAfterUnknownAcknowledgment).toBe(0);
```

- [ ] Run new recovery suites and existing notes/prompt/mention suites; confirm red for new recovery contracts.
- [ ] Implement paginated projected candidate discovery with persisted cursor, five-minute initial scan cadence, batch size five and maximum four automated attempts: an initial attempt plus retries after one, five and fifteen minutes. These are bounded initial defaults, not options. Eligibility covers abandoned nonterminal work and interrupted captures with pending stages independently of capture status. Claim with H1 version/lease transaction; actual processing also needs serving admission and available guild lease. Verify/checksum objects before assembly; reconstruct only confirmed intervals, use usable-speech gates, original settings and context/config checkpoints. Resume acknowledged stages; bypass ordinary auto-record short-meeting cancellation for a real interruption. Unknown sends and uncertain voice settlement require explicit reconciliation, not guesses.
- [ ] Run recovery/notes/prompt/mention and personal-upload regressions plus backend build. Stop/restart the worker between each stage in synthetic tests; metadata alone cannot claim notes success.
- [ ] Commit `feat: recover interrupted recordings and partial notes`; obtain scoped review.

## Task 5 (R5): Partial notices across delivery, read and export

**Files:** Create capture-notice utility; modify `src/services/meetingNotesEmbedService.ts`, `src/embed.ts`, `meetingSharePayloadService.ts`, `mcpMeetingService.ts`, `notionService.ts`, `notionAutomationService.ts`, `src/trpc/routers/meetings.ts`, `src/types/liveMeeting.ts`, `src/api/liveMeetings.ts`, `src/services/liveMeetingService.ts`; modify library status/detail helpers, live-stream hook/page, `src/frontend/features/meetingShares/PublicMeetingView.tsx`, `src/frontend/pages/library/components/meetingExport.ts`; update their existing stories/tests and public docs/What's New.

**Interfaces:** Produces `formatMeetingCaptureNotice`; it returns undefined for complete capture and a deterministic interruption/coverage notice for partial capture. Include the notice at rendering/export boundaries; do not bake it into editable notes or depend on LLM wording. Shared read payloads carry capture/recovery metadata under existing authorization.

- [ ] Write `partialNoticeSurvivesModelOutputAndNotesCorrection`, `partialDeliveryKeepsInterruptedBadge`, `allReadExportSurfacesRetainWarning`, `unknownEndIsNotDetectionTime`, `liveOwnerMissingDoesNotRenderComplete`, and `notesDisabledRemainDisabled`:

```ts
expect(partialDiscordDescription).toContain(
  "Partial notes: recording was interrupted.",
);
expect(markdownExport).toContain("These notes cover only the saved recording.");
expect(statusAfterSuccessfulPartialDelivery).toBe("interrupted");
```

- [ ] Run focused presentation/share/MCP/export/Notion tests; confirm red. Arrange deterministic generated transcript/notes fixtures, no customer data.
- [ ] Implement interrupted/starting/failed handling with confirmed saved coverage and pending recovery labels. Place warnings in every notes/summary message when content splits across messages. Keep Discord embed behavior and `allowedMentions: { parse: [] }` for any ordinary content; use shared mention resolution on all reads. Live status streams stop the endless recording spinner when interruption is known. Public share/API changes cannot grant additional access or expose internal owner/task identifiers. Update concise behavior docs, not internal deployment mechanics.
- [ ] Run Storybook for affected stories, `yarn test-storybook` screenshot capture and VLM review; inspect existing Playwright visual snapshots and run affected live/library/share visual journeys. Add a scroll assertion only if the UI change affects scrolling. Run export/Notion/MCP suites, `yarn build:all` and `yarn docs:check`. Expected: warnings and statuses persist consistently while legacy complete fixtures still render normally.
- [ ] Commit `feat: show truthful partial recording outcomes`; obtain scoped review.

## Task 6 (R6): Cross-boundary fault acceptance

**Files:** Create `test/deployment/recordingRecoveryFaults.integration.test.ts`, extend container tests, add generated fixture helpers under `test/deployment/fixtures/`; extend main-plan Sandbox acceptance runner and private evidence checklist.

**Interfaces:** Consumes all preceding tasks. Reuse H7 acceptance metadata/checksum reporting. No operational repair helper reads customer artifacts.

- [ ] Write a barrier-driven fault matrix for crash before upload, after upload/before manifest commit, after complete capture/before AI, after notes/before delivery and after send/before acknowledgment persistence. Add storage/Dynamo outages, overlapping owners, uncertain old Discord operation, invalid/corrupt/missing segments and concurrent recovery claims. Expected verified coverage and recovery stage disposition are explicit fixture values.
- [ ] Run `yarn test:deployment:integration` for fault/container suites, then focused lifecycle unit suites and `yarn lint:check`, `yarn build:all`, `yarn docs:check`. Assert every fault either produces verified recovery or explicit unknown/failed/reconciliation-required state, never fabricated complete status.
- [ ] After the user explicitly authorizes Sandbox acceptance as described in H7, repeat representative hard-stop, shutdown, preservation-cutoff and automatic partial-note cases with generated audio. Confirm the proposed 30/60/100-second targets and queue/protection margins under representative speaker/source load. Record actual timings and revise constants if evidence requires, without changing the agreed policy silently.
- [ ] Join H7 handoff acceptance and collect local/container/Sandbox evidence separately. Exact historical incident audio recovery stays UNKNOWN; this work does not repair it. Commit `test: cover recording interruption fault boundaries`; obtain whole-branch review before merge readiness.

## Self-review coverage and handoff

The approved spec maps to H1-H6 for runtime admission/protection/controls/coordinator, H3 for external voice settlement, H4/R1-R4 for truthful durability, R5 for user journeys and exports, and H7/R6 for race/fault/hosted acceptance. Legacy introduction, rollback artifact compatibility and historical repair are operational boundaries in H7, not silently solved by a new binary. Every Review Focus item has an owning test task above.

These plans name intended interfaces and acceptance tests; none has been implemented or run in this planning turn. Use the execution method selected after the user reviews the main plan.
