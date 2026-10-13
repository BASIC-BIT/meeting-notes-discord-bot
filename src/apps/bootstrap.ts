import "../observability/langfuseInstrumentation";
import "../voiceUdpGuard";
import "../ipv4first";
import { setupBot, isBotGatewayReady } from "../bot";
import { setupWebServer } from "../webserver";
import { config } from "../services/configService";
import { verifyLangfusePrompts } from "../services/langfusePromptService";
import { cleanupTempBaseDir } from "../services/tempFileService";
import { initializeRuntimeLifecycle } from "../services/runtimeStartupService";
import { startRuntimeHealthServer } from "../services/runtimeHealthServer";

export type AppBootstrapMode = "all" | "bot" | "api";

export async function bootstrapApp(mode: AppBootstrapMode) {
  console.log(`Mock mode: ${config.mock.enabled}`);
  const healthServer = config.runtime.ecs
    ? await startRuntimeHealthServer(config.server.port)
    : undefined;
  const startup = new AbortController();
  const cancel = () => startup.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  let runtime:
    Awaited<ReturnType<typeof initializeRuntimeLifecycle>> | undefined;
  try {
    runtime = await initializeRuntimeLifecycle(
      () => mode !== "api" && (config.mock.enabled || isBotGatewayReady()),
      mode,
      startup.signal,
    );
    await verifyLangfusePrompts();
    await cleanupTempBaseDir();

    if (mode !== "api" && !config.mock.enabled) {
      await setupBot();
    }

    if (mode !== "bot") {
      if (healthServer) await setupWebServer(healthServer);
      else await setupWebServer();
    }
    await runtime.ready();
  } catch (error) {
    runtime?.failed();
    await healthServer?.close();
    throw error;
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}
