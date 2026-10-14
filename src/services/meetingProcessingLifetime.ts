import type { MeetingData } from "../types/meeting-data";

type Lifetime = { controller: AbortController; effects: Set<Promise<unknown>> };
const lifetimes = new WeakMap<MeetingData, Lifetime>();
function lifetime(meeting: MeetingData): Lifetime {
  let value = lifetimes.get(meeting);
  if (!value) {
    value = { controller: new AbortController(), effects: new Set() };
    lifetimes.set(meeting, value);
  }
  return value;
}
export function getMeetingProcessingSignal(meeting: MeetingData): AbortSignal {
  const signal = lifetime(meeting).controller.signal;
  return AbortSignal.any([
    signal,
    ...(meeting.ownershipSignal ? [meeting.ownershipSignal] : []),
    ...(meeting.finalization ? [meeting.finalization.controller.signal] : []),
  ]);
}
/** Register before invoking a provider or any reentrant callback. Include the complete effect chain. */
export function runMeetingProcessingEffect<T>(
  meeting: MeetingData,
  run: () => Promise<T>,
): Promise<T> {
  const owned = lifetime(meeting);
  const signal = getMeetingProcessingSignal(meeting);
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const effect = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  owned.effects.add(effect);
  void effect.then(
    () => owned.effects.delete(effect),
    () => owned.effects.delete(effect),
  );
  try {
    signal.throwIfAborted();
    resolve(run());
  } catch (error) {
    reject(error);
  }
  return effect;
}
/** Cancellation seals future dispatch; only actual completion removes an issued effect. */
export async function stopMeetingProcessing(
  meeting: MeetingData,
): Promise<void> {
  const owned = lifetime(meeting);
  owned.controller.abort(new Error("Meeting processing interrupted"));
  while (owned.effects.size) await Promise.allSettled([...owned.effects]);
}
