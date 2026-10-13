import { z } from "zod";
import type {
  ProtectionConfirmation,
  RuntimeIdentity,
} from "../types/deploymentControl";

export const RUNTIME_PROTECTION_MINUTES = 10;
export const RUNTIME_PROTECTION_RENEWAL_MS = 60_000;
export const RUNTIME_PROTECTION_MARGIN_SECONDS = 120;
export const RUNTIME_AGENT_TIMEOUT_MS = 5_000;
const protectionResponse = z.object({
  protection: z.object({
    TaskArn: z.string(),
    ProtectionEnabled: z.boolean(),
    ExpirationDate: z.string().datetime({ offset: true }).nullable(),
  }),
});

export type RuntimeProtectionService = ReturnType<
  typeof createRuntimeProtectionService
>;

/** Only the owning runtime uses this adapter. A coordinator never releases protection. */
export function createRuntimeProtectionService(options: {
  identity: RuntimeIdentity;
  agentUri?: string;
  request?: typeof fetch;
  now?: () => number;
  onUnsafe: () => void | Promise<void>;
}) {
  const { identity } = options;
  const request = options.request ?? fetch;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let confirmation: ProtectionConfirmation | undefined;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let unsafeHandler = options.onUnsafe;
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  }
  function stop() {
    clearInterval(renewal);
    clearTimeout(deadline);
    renewal = undefined;
    deadline = undefined;
  }
  function armDeadline() {
    clearTimeout(deadline);
    if (!confirmation) return;
    deadline = setTimeout(
      () => {
        void Promise.resolve()
          .then(unsafeHandler)
          .catch(() =>
            console.error("Runtime protection safety handler failed"),
          );
      },
      Math.max(
        0,
        (confirmation.expiresAt - now() - RUNTIME_PROTECTION_MARGIN_SECONDS) *
          1000,
      ),
    );
    deadline.unref();
  }
  async function update(
    enabled: boolean,
  ): Promise<ProtectionConfirmation | undefined> {
    const provenAt = now();
    if (identity.kind === "local")
      return enabled
        ? { identity, provenAt, expiresAt: provenAt + 600 }
        : undefined;
    if (!options.agentUri) throw new Error("ECS agent URI is required");
    const response = await request(
      `${options.agentUri.replace(/\/$/, "")}/task-protection/v1/state`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          enabled
            ? {
                ProtectionEnabled: true,
                ExpiresInMinutes: RUNTIME_PROTECTION_MINUTES,
              }
            : { ProtectionEnabled: false },
        ),
        signal: AbortSignal.timeout(RUNTIME_AGENT_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error("ECS protection request failed");
    const { protection } = protectionResponse.parse(await response.json());
    if (
      protection.TaskArn !== identity.taskArn ||
      protection.ProtectionEnabled !== enabled
    )
      throw new Error("ECS protection identity or state mismatch");
    if (!enabled) return undefined;
    const expiresAt = Math.floor(
      Date.parse(protection.ExpirationDate ?? "") / 1000,
    );
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= now() + RUNTIME_PROTECTION_MARGIN_SECONDS
    )
      throw new Error("ECS protection window is unsafe");
    return { identity, provenAt, expiresAt };
  }
  async function confirm(): Promise<ProtectionConfirmation> {
    return serialize(async () => {
      const proof = await update(true);
      if (!proof) throw new Error("Protection confirmation missing");
      confirmation = proof;
      armDeadline();
      return structuredClone(proof);
    });
  }
  async function start() {
    await confirm();
    if (!renewal) {
      renewal = setInterval(() => {
        void confirm().catch(() =>
          console.warn("Runtime protection renewal failed"),
        );
      }, RUNTIME_PROTECTION_RENEWAL_MS);
      renewal.unref();
    }
  }
  async function release() {
    stop();
    confirmation = undefined;
    await serialize(async () => {
      await update(false);
      confirmation = undefined;
      clearTimeout(deadline);
    });
  }
  return {
    start,
    stop,
    release,
    confirm,
    getConfirmation: () =>
      confirmation ? structuredClone(confirmation) : undefined,
    isSafe: () =>
      Boolean(
        confirmation &&
        confirmation.expiresAt > now() + RUNTIME_PROTECTION_MARGIN_SECONDS,
      ),
    setUnsafeHandler(handler: () => void | Promise<void>) {
      unsafeHandler = handler;
    },
  };
}
