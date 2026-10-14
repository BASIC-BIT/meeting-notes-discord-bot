/** One absolute grace allowance. Tightening it never creates a new signal or allowance. */
export function createPreservationBudget(initialDeadline: number) {
  const controller = new AbortController();
  let deadline = initialDeadline;
  let timer: ReturnType<typeof setTimeout>;
  function arm() {
    clearTimeout(timer);
    if (deadline <= Date.now())
      controller.abort(new Error("Preservation deadline reached"));
    else
      timer = setTimeout(
        () => controller.abort(new Error("Preservation deadline reached")),
        deadline - Date.now(),
      );
  }
  arm();
  return {
    signal: controller.signal,
    get deadline() {
      return deadline;
    },
    shorten(value: number) {
      if (value >= deadline) return;
      deadline = value;
      arm();
    },
    async wait<T>(
      promise: Promise<T>,
    ): Promise<{ kind: "settled"; value: T } | { kind: "unresolved" }> {
      if (controller.signal.aborted) return { kind: "unresolved" };
      let abort = () => {};
      try {
        return await Promise.race([
          promise.then(
            (value) =>
              controller.signal.aborted
                ? { kind: "unresolved" as const }
                : { kind: "settled" as const, value },
            () => ({ kind: "unresolved" as const }),
          ),
          new Promise<{ kind: "unresolved" }>((resolve) => {
            abort = () => resolve({ kind: "unresolved" });
            controller.signal.addEventListener("abort", abort, { once: true });
          }),
        ]);
      } finally {
        controller.signal.removeEventListener("abort", abort);
      }
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
export type PreservationBudget = ReturnType<typeof createPreservationBudget>;
