/** A submitted automatic mutation has no durable acknowledgment. Never turn it into a retryable failure. */
export class UnresolvedNotionMutation extends Error {
  constructor(cause: unknown) {
    super("Automatic Notion mutation outcome is unknown", { cause });
  }
}
export async function runNotionMutation<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  try {
    return await run();
  } catch (error) {
    if (signal) throw new UnresolvedNotionMutation(error);
    throw error;
  }
}
export function assertNotionOutcomeKnown(
  error: unknown,
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted();
  if (error instanceof UnresolvedNotionMutation) throw error;
}
