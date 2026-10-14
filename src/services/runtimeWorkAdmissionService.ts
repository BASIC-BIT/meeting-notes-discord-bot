import type {
  RuntimeWorkHandle,
  WorkAdmissionAuthority,
  SessionOwnership,
  SessionReservation,
} from "../types/deploymentControl";
import {
  beginRuntimeWork,
  getRuntimeAdmissionContext,
} from "./runtimeLifecycleService";
import {
  getOwnedSessionReservations,
  getReservationSignal,
  isReservationControlEligible,
} from "./activeMeetingLeaseService";

type Domain = "control" | "personal" | "interaction" | "ancillary";
type ClaimCheckpoint = {
  claimId: string;
  instanceId: string;
  attempt?: number;
  expiresAt: number;
};
type Checkpoint = {
  id: string;
  domain: Domain;
  stage: "pending" | "owned" | "unresolved";
  controller: AbortController;
  handle: RuntimeWorkHandle;
  claim?: ClaimCheckpoint;
  session?: SessionOwnership;
  localSettled: boolean;
  ownedPromise?: Promise<unknown>;
  ownedSettled?: boolean;
  effects: Set<Promise<unknown>>;
  terminalAcknowledged?: ClaimCheckpoint;
};
const work = new Map<string, Checkpoint>();
const closingSessions = new WeakSet<SessionReservation>();

function resolveParentSession(
  domain: Domain,
  session?: { guildId: string; meetingId?: string },
) {
  const owned = session
    ? getOwnedSessionReservations().find(
        ({ reservation }) =>
          reservation.guildId === session.guildId &&
          (!session.meetingId || reservation.meetingId === session.meetingId),
      )
    : undefined;
  if (session && (!owned || !["control", "interaction"].includes(domain)))
    throw new Error("Session control is not locally owned");
  if (owned) getReservationSignal(owned.reservation).throwIfAborted();
  const parent = owned?.reservation;
  if (
    parent &&
    (closingSessions.has(parent) || !isReservationControlEligible(parent))
  )
    throw new Error("Session control ownership is closing");
  return parent;
}

/** Counts before admission I/O. Unknown writes stay counted for R3 reconciliation. */
export function beginRuntimeWorkClaim(
  domain: Domain,
  id: string,
  session?: { guildId: string; meetingId?: string },
) {
  if (work.has(id)) throw new Error("Runtime work is already registered");
  const parent = resolveParentSession(domain, session);
  const registration = parent
    ? undefined
    : beginRuntimeWork("pending_admission");
  const handle = parent ? parent.workHandle.beginOwnedControl() : registration!;
  const checkpoint: Checkpoint = {
    id,
    domain,
    stage: "pending",
    controller: new AbortController(),
    handle,
    session: parent
      ? {
          guildId: parent.guildId,
          meetingId: parent.meetingId,
          ownerInstanceId: parent.ownerInstanceId,
          executionVersion: parent.executionVersion,
          voiceOperationAttemptId: parent.voiceOperationAttemptId,
        }
      : undefined,
    localSettled: false,
    effects: new Set(),
  };
  const parentSignal = parent ? getReservationSignal(parent) : undefined;
  const onParentFence = () => {
    checkpoint.stage = "unresolved";
    checkpoint.controller.abort();
  };
  parentSignal?.addEventListener("abort", onParentFence, { once: true });
  work.set(id, checkpoint);
  let acceptingEffects = true;
  return {
    signal: checkpoint.controller.signal,
    trackPromise<T>(run: () => Promise<T>): Promise<T> {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      checkpoint.ownedPromise = promise;
      checkpoint.ownedSettled = false;
      void promise.then(
        () => {
          checkpoint.ownedSettled = true;
        },
        () => {
          checkpoint.ownedSettled = true;
        },
      );
      try {
        resolve(run());
      } catch (error) {
        reject(error);
      }
      return promise;
    },
    trackEffect<T>(run: () => Promise<T>): Promise<T> {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (error: unknown) => void;
      const effect = new Promise<T>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      checkpoint.effects.add(effect);
      void effect.then(
        () => checkpoint.effects.delete(effect),
        () => checkpoint.effects.delete(effect),
      );
      try {
        if (!acceptingEffects)
          throw new Error("Runtime work effects are closing");
        checkpoint.controller.signal.throwIfAborted();
        resolve(run());
      } catch (error) {
        reject(error);
      }
      return effect;
    },
    acknowledgeTerminal() {
      if (!checkpoint.claim)
        throw new Error("Terminal acknowledgment requires the original claim");
      checkpoint.terminalAcknowledged = { ...checkpoint.claim };
    },
    recordClaim(claim: ClaimCheckpoint) {
      checkpoint.claim = claim;
    },
    async authority(): Promise<WorkAdmissionAuthority> {
      checkpoint.controller.signal.throwIfAborted();
      if (parent)
        return {
          kind: "session",
          ownership: parent,
          now: Math.floor(Date.now() / 1000),
        };
      const context = await getRuntimeAdmissionContext();
      checkpoint.controller.signal.throwIfAborted();
      return { kind: "serving", context };
    },
    claimed() {
      checkpoint.controller.signal.throwIfAborted();
      checkpoint.stage = "owned";
      registration?.transition(
        domain === "personal" ? "personal_processing" : "ancillary_delivery",
      );
    },
    delivering() {
      checkpoint.controller.signal.throwIfAborted();
      registration?.transition("ancillary_delivery");
      checkpoint.domain = "ancillary";
    },
    fence() {
      checkpoint.stage = "unresolved";
      checkpoint.controller.abort();
    },
    async settle() {
      acceptingEffects = false;
      while (checkpoint.effects.size)
        await Promise.allSettled([...checkpoint.effects]);
      checkpoint.localSettled = true;
      parentSignal?.removeEventListener("abort", onParentFence);
      if (checkpoint.controller.signal.aborted) return;
      handle.settle();
      work.delete(id);
    },
  };
}
export type RuntimeWorkClaim = ReturnType<typeof beginRuntimeWorkClaim>;
export function getRuntimeWorkAdmissionCheckpoints() {
  return [...work.values()].map(
    ({
      id,
      domain,
      stage,
      controller,
      claim,
      session,
      localSettled,
      ownedPromise,
      effects,
      terminalAcknowledged,
    }) => ({
      id,
      domain,
      stage,
      claim,
      session: session
        ? {
            guildId: session.guildId,
            meetingId: session.meetingId,
            ownerInstanceId: session.ownerInstanceId,
            executionVersion: session.executionVersion,
            voiceOperationAttemptId: session.voiceOperationAttemptId,
          }
        : undefined,
      localSettled,
      ownedPromise,
      effects: [...effects],
      terminalAcknowledged,
      signal: controller.signal,
      fenced: controller.signal.aborted,
    }),
  );
}
export function fenceRuntimeWorkAdmissions() {
  for (const entry of work.values()) {
    entry.stage = "unresolved";
    entry.controller.abort();
  }
}
export function fenceRuntimeWorkAdmission(id: string): void {
  const entry = work.get(id);
  if (!entry) return;
  entry.stage = "unresolved";
  entry.controller.abort();
}

/** A terminal acknowledgment permits release only after its exact owner's complete local lifetime. */
export function releaseAcknowledgedRuntimeWork(id: string): boolean {
  const entry = work.get(id);
  if (!entry) return true;
  const acknowledged = entry.terminalAcknowledged;
  const claim = entry.claim;
  if (
    !entry.localSettled ||
    !entry.ownedSettled ||
    entry.effects.size ||
    !acknowledged ||
    !claim ||
    acknowledged.claimId !== claim.claimId ||
    acknowledged.instanceId !== claim.instanceId ||
    acknowledged.attempt !== claim.attempt ||
    acknowledged.expiresAt !== claim.expiresAt
  )
    return false;
  entry.handle.settle();
  work.delete(id);
  return true;
}
function sameSession(
  left: SessionOwnership | undefined,
  right: SessionOwnership,
) {
  return (
    left?.guildId === right.guildId &&
    left.meetingId === right.meetingId &&
    left.ownerInstanceId === right.ownerInstanceId &&
    left.executionVersion === right.executionVersion &&
    left.voiceOperationAttemptId === right.voiceOperationAttemptId
  );
}
export async function fenceAndSettleSessionWork(
  session: SessionOwnership,
): Promise<boolean> {
  for (const { reservation } of getOwnedSessionReservations()) {
    if (sameSession(reservation, session)) closingSessions.add(reservation);
  }
  const children = [...work.values()].filter((entry) =>
    sameSession(entry.session, session),
  );
  for (const child of children) {
    child.stage = "unresolved";
    child.controller.abort();
  }
  await Promise.allSettled(children.map((child) => child.ownedPromise));
  for (const child of children)
    while (child.effects.size) await Promise.allSettled([...child.effects]);
  return children
    .map((child) => releaseAcknowledgedRuntimeWork(child.id))
    .every(Boolean);
}
