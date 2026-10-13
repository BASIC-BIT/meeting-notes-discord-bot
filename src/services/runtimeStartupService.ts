import { config } from "./configService";
import { getDeploymentControlRepository } from "../db";
import {
  getRuntimeInstanceId,
  resolveRuntimeIdentity,
} from "./runtimeInstanceService";
import { createRuntimeProtectionService } from "./runtimeProtectionService";
import {
  createRuntimeLifecycle,
  installRuntimeLifecycle,
  startRuntimeLifecycle,
} from "./runtimeLifecycleService";
import { isRuntimeCacheReady } from "./cacheService";
import type { RuntimeReadiness } from "../types/deploymentControl";

/** Startup installs protection before login, HTTP listeners, or worker startup. */
export async function initializeRuntimeLifecycle(
  gatewayReady: () => boolean,
  runtimeMode: RuntimeReadiness["runtimeMode"],
) {
  const identity = await resolveRuntimeIdentity(
    config.runtime.ecs
      ? {
          kind: "ecs",
          metadataUri: config.runtime.metadataUri,
          candidateId: config.runtime.candidateId,
        }
      : { kind: "local", localId: getRuntimeInstanceId() },
  );
  const repository = getDeploymentControlRepository();
  let dependenciesReady = false;
  const protection = createRuntimeProtectionService({
    identity,
    agentUri: config.runtime.agentUri,
    onUnsafe: () => undefined,
  });
  const lifecycle = createRuntimeLifecycle({
    identity,
    runtimeMode,
    repository,
    protection,
    probeReadiness: async () => ({
      gatewayReady: gatewayReady(),
      cacheReady: await isRuntimeCacheReady(),
      dependenciesReady,
    }),
    ...(identity.kind === "local"
      ? { checkpointAndFence: async () => undefined }
      : {}),
  });
  if (identity.kind === "local")
    await repository.initializeControl({
      pk: "ENV",
      sk: "CONTROL",
      recordType: "control",
      protocolVersion: 1,
      coordinatorToken: identity.localId,
      coordinatorEpoch: 0,
      coordinatorExpiresAt: Math.floor(Date.now() / 1000) + 900,
      servingGeneration: 0,
      servingMembers: {},
    });
  installRuntimeLifecycle(lifecycle);
  await startRuntimeLifecycle(identity);
  return {
    async ready() {
      dependenciesReady = true;
      await lifecycle.refreshRuntimeReadiness();
      if (identity.kind === "local") {
        const control = await repository.getRecord("ENV", "CONTROL");
        if (
          control?.recordType !== "control" ||
          control.coordinatorToken !== identity.localId
        )
          throw new Error("Local runtime requires its own deployment control");
        if (
          (await repository.promote({
            coordinatorToken: control.coordinatorToken,
            coordinatorEpoch: control.coordinatorEpoch,
            expectedServingGeneration: control.servingGeneration,
            expectedServingMembers: Object.values(control.servingMembers),
            candidate: identity,
            candidateRuntimeMode: runtimeMode,
            proposedGeneration: control.servingGeneration + 1,
            now: Math.floor(Date.now() / 1000),
          })) !== "applied"
        )
          throw new Error("Local runtime is not ready");
        await lifecycle.refreshRuntimeReadiness();
      }
    },
    failed() {
      lifecycle.closeAdmission();
      lifecycle.stop();
    },
  };
}
