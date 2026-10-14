/** @jest-environment node */
import { createPreservationBudget } from "../../src/services/preservationBudget";

afterEach(() => jest.useRealTimers());
test("oneDeadlineAcrossConcurrentMeetings", async () => {
  jest.useFakeTimers();
  const budget = createPreservationBudget(Date.now() + 100_000);
  const outcomes = [
    budget.wait(new Promise(() => {})),
    budget.wait(new Promise(() => {})),
  ];
  await jest.advanceTimersByTimeAsync(100_000);
  expect(await Promise.all(outcomes)).toEqual([
    { kind: "unresolved" },
    { kind: "unresolved" },
  ]);
  expect(budget.signal.aborted).toBe(true);
  budget.dispose();
});
test("an overlapping shutdown shortens existing preservation without renewing grace", async () => {
  jest.useFakeTimers();
  const budget = createPreservationBudget(Date.now() + 100_000);
  const pending = budget.wait(new Promise(() => {}));
  budget.shorten(Date.now() + 10_000);
  budget.shorten(Date.now() + 200_000);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(await pending).toEqual({ kind: "unresolved" });
  expect(budget.signal.aborted).toBe(true);
  budget.dispose();
});
test("completion after expiry never becomes observed settlement", async () => {
  jest.useFakeTimers();
  let finish!: () => void;
  const effect = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const budget = createPreservationBudget(Date.now() + 100);
  const pending = budget.wait(effect);
  await jest.advanceTimersByTimeAsync(100);
  finish();
  expect(await pending).toEqual({ kind: "unresolved" });
  budget.dispose();
});
