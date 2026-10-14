import type { Client } from "discord.js";
import { randomUUID } from "node:crypto";
import type { MeetingControlCommand } from "../types/meetingControl";
import type { WorkAdmissionAuthority } from "../types/deploymentControl";
import {
  beginRuntimeWorkClaim,
  type RuntimeWorkClaim,
} from "./runtimeWorkAdmissionService";
import { getOwnedSessionReservations } from "./activeMeetingLeaseService";
import { getMeetingControlCommandRepository } from "../repositories/meetingControlCommandRepository";
import { executeMeetingControlCommand } from "./meetingControlBotService";
import { getRuntimeInstanceId } from "./runtimeInstanceService";

const WORKER_POLL_INTERVAL_MS = 2_000;
const WORKER_CLAIM_SECONDS = 60;
const WORKER_CLAIM_RENEWAL_MS = 30_000;
const WORKER_BATCH_SIZE = 5;

let workerTimer: ReturnType<typeof setInterval> | undefined;
let pollInProgress = false;

const epochSeconds = () => Math.floor(Date.now() / 1000);
const nowIso = () => new Date().toISOString();

export function processMeetingControlCommand(
  client: Client,
  command: MeetingControlCommand,
): Promise<void> {
  let work: RuntimeWorkClaim;
  const instanceId = getRuntimeInstanceId();
  const local =
    command.commandType !== "start_meeting" && command.input.serverId
      ? getOwnedSessionReservations().find(
          ({ reservation }) => reservation.guildId === command.input.serverId,
        )
      : undefined;
  try {
    work = beginRuntimeWorkClaim(
      "control",
      command.requestId,
      local
        ? {
            guildId: local.reservation.guildId,
            meetingId: local.reservation.meetingId,
          }
        : undefined,
    );
  } catch {
    return Promise.resolve();
  }
  return work.trackPromise(() => runCommand(client, command, instanceId, work));
}

async function runCommand(
  client: Client,
  command: MeetingControlCommand,
  instanceId: string,
  work: RuntimeWorkClaim,
) {
  let authority: WorkAdmissionAuthority;
  try {
    authority = await work.authority();
  } catch {
    await work.settle();
    return;
  }
  const repository = getMeetingControlCommandRepository();
  const claimId = randomUUID();
  const claimInput = {
    requestId: command.requestId,
    instanceId,
    claimId,
    nowEpochSeconds: epochSeconds(),
    claimExpiresAt: epochSeconds() + WORKER_CLAIM_SECONDS,
    updatedAt: nowIso(),
    authority,
  };
  work.recordClaim({
    claimId,
    instanceId,
    expiresAt: claimInput.claimExpiresAt,
  });
  let claimed;
  try {
    claimed = await repository.claimCommand(claimInput);
  } catch {
    work.fence();
    await work.settle();
    return;
  }
  if (!claimed) {
    await work.settle();
    return;
  }
  try {
    work.claimed();
  } catch {
    work.fence();
    await work.settle();
    return;
  }
  const assertOwned = async () => {
    work.signal.throwIfAborted();
    if (
      !(await repository.renewCommand({
        ...claimInput,
        nowEpochSeconds: epochSeconds(),
        claimExpiresAt: epochSeconds() + WORKER_CLAIM_SECONDS,
        updatedAt: nowIso(),
      }))
    ) {
      work.fence();
      throw new Error("Control claim lost");
    }
    work.signal.throwIfAborted();
  };
  const renewalTimer = setInterval(() => {
    void work
      .trackEffect(() => assertOwned().catch(() => work.fence()))
      .catch(() => {});
  }, WORKER_CLAIM_RENEWAL_MS);
  renewalTimer.unref();
  try {
    const result = await executeMeetingControlCommand(
      client,
      claimed,
      assertOwned,
      work.signal,
    );
    work.signal.throwIfAborted();
    const committed = await repository.completeCommand({
      requestId: command.requestId,
      instanceId,
      claimId,
      nowEpochSeconds: epochSeconds(),
      updatedAt: nowIso(),
      result,
    });
    if (!committed) work.fence();
    else work.acknowledgeTerminal();
  } catch (error) {
    if (!work.signal.aborted) {
      try {
        if (
          !(await repository.failCommand({
            requestId: command.requestId,
            instanceId,
            claimId,
            nowEpochSeconds: epochSeconds(),
            updatedAt: nowIso(),
            error: error instanceof Error ? error.message : String(error),
          }))
        )
          work.fence();
        else work.acknowledgeTerminal();
      } catch {
        work.fence();
      }
    }
  } finally {
    clearInterval(renewalTimer);
    await work.settle();
  }
}

async function pollMeetingControlCommands(client: Client) {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    const commands =
      await getMeetingControlCommandRepository().listClaimablePendingCommands({
        instanceId: getRuntimeInstanceId(),
        nowEpochSeconds: epochSeconds(),
        limit: WORKER_BATCH_SIZE,
      });
    for (const command of commands)
      await processMeetingControlCommand(client, command);
  } catch (error) {
    console.error("Meeting control command worker failed", error);
  } finally {
    pollInProgress = false;
  }
}

export function startMeetingControlCommandWorker(client: Client) {
  if (workerTimer) return;
  void pollMeetingControlCommands(client);
  workerTimer = setInterval(() => {
    void pollMeetingControlCommands(client);
  }, WORKER_POLL_INTERVAL_MS);
}

export function stopMeetingControlCommandWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
}
