import "./voiceUdpGuard"; // Apply UDP send guard before the bot starts
import { setupBot } from "./bot";
import { setupWebServer } from "./webserver";
import { config } from "./services/configService";

console.log(`Mock mode: ${config.mock.enabled}`);

if (!config.mock.enabled) {
  setupBot();
}
setupWebServer();
import "./ipv4first";
