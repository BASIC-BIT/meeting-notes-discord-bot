import "../observability/langfuseInstrumentation";
import "../voiceUdpGuard";
import "../ipv4first";
import { setupBot, isBotGatewayReady } from "../bot";
import { setupWebServer } from "../webserver";
import { config } from "../services/configService";
import { verifyLangfusePrompts } from "../services/langfusePromptService";
import { cleanupTempBaseDir } from "../services/tempFileService";
import { initializeRuntimeLifecycle } from "../services/runtimeStartupService";

export type AppBootstrapMode = "all" | "bot" | "api";

export async function bootstrapApp(mode: AppBootstrapMode) {
  console.log(`Mock mode: ${config.mock.enabled}`);
  const runtime = await initializeRuntimeLifecycle(
    () => mode !== "api" && (config.mock.enabled || isBotGatewayReady()),
    mode,
  );
  try {
    await verifyLangfusePrompts();
    await cleanupTempBaseDir();

    if (mode !== "api" && !config.mock.enabled) {
      await setupBot();
    }

    if (mode !== "bot") {
      await setupWebServer();
    }
    await runtime.ready();
  } catch (error) {
    runtime.failed();
    throw error;
  }
}
