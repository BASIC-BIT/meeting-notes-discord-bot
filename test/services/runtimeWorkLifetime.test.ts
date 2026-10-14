/** @jest-environment node */
import {
  beginRuntimeWorkClaim,
  getRuntimeWorkAdmissionCheckpoints,
} from "../../src/services/runtimeWorkAdmissionService";
jest.mock("../../src/services/activeMeetingLeaseService", () => ({
  getOwnedSessionReservations: () => [],
}));
jest.mock("../../src/services/runtimeLifecycleService", () => ({
  beginRuntimeWork: () => ({ settle: jest.fn(), transition: jest.fn() }),
}));

test("settlement seals new effects and retains an already-issued full chain", async () => {
  const work = beginRuntimeWorkClaim("personal", "synthetic-lifetime");
  let complete!: () => void;
  const task = work.trackEffect(
    () =>
      new Promise<void>((done) => {
        complete = done;
      }),
  );
  const settled = work.settle();
  const late = jest.fn(async () => {});
  await expect(work.trackEffect(late)).rejects.toThrow();
  expect(late).not.toHaveBeenCalled();
  expect(getRuntimeWorkAdmissionCheckpoints()[0].localSettled).toBe(false);
  complete();
  await task;
  await settled;
  expect(getRuntimeWorkAdmissionCheckpoints()).toHaveLength(0);
});
