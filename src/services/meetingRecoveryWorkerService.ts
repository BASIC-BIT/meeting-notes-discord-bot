import { recoveryHistoryKey } from "../types/meetingRecovery";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { getDeploymentControlRepository } from "../db";
import type { DeploymentControlRepository } from "../repositories/deploymentControlRepository";
import { prepareRecoveryClaim } from "../repositories/meetingRecoveryRepository";
import type { ControlRecord, HistoryKey } from "../types/deploymentControl";
import type { RecoveryClaim } from "../types/meetingRecovery";
import {
  beginRuntimeWorkClaim,
  type RuntimeWorkClaim,
  releaseAcknowledgedRuntimeWork,
} from "./runtimeWorkAdmissionService";
import { createRecordingCheckpointService } from "./recordingCheckpointService";
import {
  recoverMeeting,
  type RecoveryDependencies,
} from "./meetingRecoveryService";
import { recoverTranscript } from "./meetingRecoveryContent";
import {
  ensureMeetingNotes,
  ensureMeetingSummaries,
} from "./meetingNotesService";
import { uploadObjectToS3 } from "./storageService";
import { createDiscordMessage } from "./discordMessageService";

type WorkerDependencies = {
  repository: DeploymentControlRepository;
  begin: typeof beginRuntimeWorkClaim;
  recover: typeof recoverMeeting;
  content: Omit<
    RecoveryDependencies,
    "repository" | "signal" | "now" | "effect"
  >;
  now(): number;
};
export function createMeetingRecoveryWorker(deps: WorkerDependencies) {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  const handlers = new Set<Promise<void>>();
  let unresolvedCursor:
    { id: string; work: RuntimeWorkClaim; expected: ControlRecord } | undefined;
  let transientCursor: HistoryKey | undefined;
  const sameControl = (actual: unknown, expected: ControlRecord) =>
    isDeepStrictEqual(
      JSON.parse(JSON.stringify(actual ?? null)),
      JSON.parse(JSON.stringify(expected)),
    );

  function register(claim: RecoveryClaim, work: RuntimeWorkClaim) {
    work.recordClaim({
      claimId: claim.lease.recoveryAttemptId,
      instanceId: claim.lease.ownerInstanceId,
      attempt: claim.history.recovery!.attempt,
      expiresAt: claim.lease.leaseExpiresAt,
    });
  }
  async function claimKey(
    key: HistoryKey,
    work: RuntimeWorkClaim,
    submitted: () => void,
  ) {
    const authority = await work.authority();
    if (authority.kind !== "serving")
      throw new Error("Recovery requires serving admission");
    const history = await work.trackEffect(() =>
      deps.repository.getMeetingHistory(key, work.signal),
    );
    if (!history || history.status === "cancelled") return;
    const lease = await work.trackEffect(() =>
      deps.repository.getRecoveryLease(history.guildId),
    );
    const input = {
      history,
      lease,
      context: { ...authority.context, now: deps.now() },
      attemptId: randomUUID(),
    };
    const expected = prepareRecoveryClaim(input);
    if (!expected) return;
    try {
      return await work.trackEffect(() => {
        register(expected, work);
        submitted();
        return deps.repository.claimRecordingRecovery(input);
      });
    } catch (error) {
      const [current, owned] = await Promise.all([
        work.trackEffect(() =>
          deps.repository.getMeetingHistory(key, work.signal),
        ),
        work.trackEffect(() =>
          deps.repository.getRecoveryLease(history.guildId),
        ),
      ]);
      if (
        !isDeepStrictEqual(current, expected.history) ||
        !isDeepStrictEqual(owned, expected.lease)
      )
        throw error;
      return expected;
    }
  }
  async function release(claim: RecoveryClaim, work: RuntimeWorkClaim) {
    try {
      if (
        await work.trackEffect(() =>
          deps.repository.releaseRecordingRecovery(claim, deps.now()),
        )
      )
        return;
    } catch {
      /* Readback proves only this exact terminal history and remote absence. */
    }
    const [history, lease] = await Promise.all([
      work.trackEffect(() =>
        deps.repository.getMeetingHistory(
          recoveryHistoryKey(claim.history),
          work.signal,
        ),
      ),
      work.trackEffect(() =>
        deps.repository.getRecoveryLease(claim.history.guildId),
      ),
    ]);
    if (lease || !isDeepStrictEqual(history, claim.history))
      throw new Error("Recovery release is unresolved");
  }
  function process(key: HistoryKey) {
    key = recoveryHistoryKey(key);
    let work: RuntimeWorkClaim;
    try {
      work = deps.begin(
        "recovery",
        `recovery:${key.guildId}:${key.channelId_timestamp}`,
      );
    } catch {
      return Promise.resolve();
    }
    const handler = work.trackPromise(async () => {
      let renewal: ReturnType<typeof setInterval> | undefined;
      let renewing: Promise<void> | undefined;
      let submitted = false;
      try {
        if (stopped) return;
        const claim = await claimKey(key, work, () => {
          submitted = true;
        });
        if (!claim) return;
        register(claim, work);
        work.claimed();
        renewal = setInterval(() => {
          if (renewing || stopped || work.signal.aborted) return;
          renewing = work
            .trackEffect(async () => {
              const lease = await deps.repository.renewRecordingRecovery(
                claim,
                deps.now(),
              );
              if (!lease) throw new Error("Recovery lease lost");
              claim.lease = lease;
              register(claim, work);
            })
            .catch(() => work.fence())
            .finally(() => {
              renewing = undefined;
            });
        }, 10000);
        renewal.unref();
        await deps.recover(claim, {
          ...deps.content,
          repository: deps.repository,
          signal: work.signal,
          now: deps.now,
          effect: (run) => work.trackEffect(run),
        });
        clearInterval(renewal);
        await renewing;
        work.signal.throwIfAborted();
        if (claim.history.recovery?.disposition === "claimed")
          throw new Error("Recovery disposition remains unresolved");
        await release(claim, work);
        work.acknowledgeTerminal();
      } catch {
        work.fence();
      } finally {
        clearInterval(renewal);
        await renewing;
        if (!submitted) work.acknowledgeReadOnlyRecoveryPoll();
        await work.settle();
      }
    });
    handlers.add(handler);
    void handler.finally(() => handlers.delete(handler));
    return handler;
  }
  async function saveCursor(
    work: RuntimeWorkClaim,
    id: string,
    control: ControlRecord,
    context: Parameters<DeploymentControlRepository["saveRecoveryCursor"]>[0],
    next: HistoryKey | undefined,
  ) {
    const expected = { ...control, recoveryScanCursor: next };
    let submitted = false;
    try {
      await work.trackEffect(() => {
        submitted = true;
        return deps.repository.saveRecoveryCursor(
          context,
          control.recoveryScanCursor,
          next,
        );
      });
      return true;
    } catch {
      if (!submitted) return true;
      try {
        const current = await work.trackEffect(() =>
          deps.repository.getRecord("ENV", "CONTROL"),
        );
        if (sameControl(current, expected)) return true;
      } catch {
        /* The original cursor mutation remains owned when readback is unavailable. */
      }
      unresolvedCursor = { id, work, expected };
      transientCursor = next;
      return false;
    }
  }
  async function runPoll(work: RuntimeWorkClaim, id: string) {
    let cursorKnown = true;
    try {
      const authority = await work.authority();
      if (authority.kind !== "serving") return;
      const control = await work.trackEffect(() =>
        deps.repository.getRecord("ENV", "CONTROL"),
      );
      if (control?.recordType !== "control" || stopped) return;
      if (unresolvedCursor && sameControl(control, unresolvedCursor.expected)) {
        unresolvedCursor.work.acknowledgeReadOnlyRecoveryPoll();
        releaseAcknowledgedRuntimeWork(unresolvedCursor.id);
        unresolvedCursor = undefined;
        transientCursor = undefined;
      }
      const page = await work.trackEffect(() =>
        deps.repository.discoverRecordingRecoveries(
          unresolvedCursor ? transientCursor : control.recoveryScanCursor,
        ),
      );
      for (const key of page.keys) {
        if (stopped) break;
        await process(key);
      }
      if (stopped) return;
      if (unresolvedCursor) {
        transientCursor = page.cursor;
        return;
      }
      cursorKnown = await saveCursor(
        work,
        id,
        control,
        { ...authority.context, now: deps.now() },
        page.cursor,
      );
      if (!cursorKnown) work.fence();
    } catch {
      work.fence();
    } finally {
      if (cursorKnown) work.acknowledgeReadOnlyRecoveryPoll();
      await work.settle();
    }
  }
  function poll(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    let work: RuntimeWorkClaim;
    const id = `recovery:poll:${randomUUID()}`;
    try {
      work = deps.begin("recovery", id);
    } catch {
      return Promise.resolve();
    }
    const actual = work.trackPromise(() => runPoll(work, id));
    pending = actual;
    void actual.finally(() => {
      if (pending === actual) pending = undefined;
    });
    return actual;
  }
  return {
    poll,
    process,
    start() {
      if (stopped || timer) return;
      void poll();
      timer = setInterval(
        () => {
          void poll();
        },
        5 * 60 * 1000,
      );
      timer.unref();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      return Promise.all([pending, ...handlers]).then(() => undefined);
    },
  };
}
let worker: ReturnType<typeof createMeetingRecoveryWorker> | undefined;
let sealed = false;
export function startMeetingRecoveryWorker() {
  if (sealed || worker) return;
  worker = createMeetingRecoveryWorker({
    repository: getDeploymentControlRepository(),
    begin: beginRuntimeWorkClaim,
    recover: recoverMeeting,
    now: () => Math.floor(Date.now() / 1000),
    content: {
      reader: createRecordingCheckpointService(),
      notes: ensureMeetingNotes,
      summaries: ensureMeetingSummaries,
      transcript: recoverTranscript,
      upload: uploadObjectToS3,
      send: createDiscordMessage,
    },
  });
  worker.start();
}
export function stopMeetingRecoveryWorker(): Promise<void> {
  sealed = true;
  return worker?.stop() ?? Promise.resolve();
}
