import type {
  RuntimeWorkHandle,
  WorkAdmissionAuthority,
  SessionOwnership,
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
};
const work = new Map<string, Checkpoint>();

/** Counts before admission I/O. Unknown writes stay counted for R3 reconciliation. */
export function beginRuntimeWorkClaim(
  domain: Domain,
  id: string,
  session?: { guildId: string; meetingId?: string },
) {
  if (work.has(id)) throw new Error("Runtime work is already registered");
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
  if (parent && !isReservationControlEligible(parent))
    throw new Error("Session control ownership is closing");
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
    session: parent,
    localSettled: false,
  };
  const parentSignal = parent ? getReservationSignal(parent) : undefined;
  const onParentFence = () => {
    checkpoint.stage = "unresolved";
    checkpoint.controller.abort();
  };
  parentSignal?.addEventListener("abort", onParentFence, { once: true });
  work.set(id, checkpoint);
  return {
    signal: checkpoint.controller.signal,
    trackPromise<T>(promise: Promise<T>): Promise<T> {
      checkpoint.ownedPromise = promise;
      return promise;
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
    settle() {
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
