import "./voiceUdpGuard"; // Apply UDP send guard before the bot starts
import { setupBot } from "./bot";
import { setupWebServer } from "./webserver";

setupBot();
setupWebServer();
import "./ipv4first";
