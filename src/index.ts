import "./observability/langfuseInstrumentation";
import "./voiceUdpGuard"; // Apply UDP send guard before the bot starts
import { setupBot } from "./bot";
import { setupWebServer } from "./webserver";
import { config } from "./services/configService";
import { verifyLangfusePrompts } from "./services/langfusePromptService";

async function bootstrap() {
  console.log(`Mock mode: ${config.mock.enabled}`);
  await verifyLangfusePrompts();
  if (!config.mock.enabled) {
    setupBot();
  }
  setupWebServer();
}

bootstrap().catch((error) => {
  console.error("Startup failed.", error);
  process.exit(1);
});
import "./ipv4first";
