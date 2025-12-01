import dotenv from "dotenv";

// Load environment variables once
dotenv.config();

/**
 * Centralized configuration service
 * All environment variable access should go through this service
 */
class ConfigService {
  // Discord Configuration
  readonly discord = {
    botToken: process.env.DISCORD_BOT_TOKEN!,
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    callbackUrl: process.env.DISCORD_CALLBACK_URL!,
  };

  // OpenAI Configuration
  readonly openai = {
    apiKey: process.env.OPENAI_API_KEY!,
    organizationId: process.env.OPENAI_ORGANIZATION_ID,
    projectId: process.env.OPENAI_PROJECT_ID,
  };

  // Context and Memory Configuration
  readonly context = {
    enableMemory: process.env.ENABLE_CONTEXT_MEMORY !== "false",
    memoryDepth: parseInt(process.env.MEMORY_DEPTH || "5", 10),
    maxContextLength: parseInt(process.env.MAX_CONTEXT_LENGTH || "30000", 10),
    testMode: process.env.CONTEXT_TEST_MODE === "true",
  };

  // Database Configuration
  readonly database = {
    useLocalDynamoDB:
      process.env.NODE_ENV === "development" &&
      process.env.USE_LOCAL_DYNAMODB === "true",
  };

  // Server Configuration
  readonly server = {
    port: parseInt(process.env.PORT || "3001", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    oauthSecret: process.env.OAUTH_SECRET || "",
    oauthEnabled: process.env.ENABLE_OAUTH !== "false",
    npmPackageVersion: process.env.npm_package_version || "unknown",
  };

  constructor() {
    // Validate required configuration
    this.validateConfig();
  }

  private validateConfig() {
    const required = [
      { name: "DISCORD_BOT_TOKEN", value: this.discord.botToken },
      { name: "DISCORD_CLIENT_ID", value: this.discord.clientId },
      { name: "OPENAI_API_KEY", value: this.openai.apiKey },
    ];

    // Only require OAuth-related secrets if OAuth is enabled (default true)
    if (this.server.oauthEnabled) {
      required.push(
        { name: "DISCORD_CLIENT_SECRET", value: this.discord.clientSecret },
        { name: "DISCORD_CALLBACK_URL", value: this.discord.callbackUrl },
        { name: "OAUTH_SECRET", value: this.server.oauthSecret },
      );
    }

    const missing = required.filter((item) => !item.value);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing
          .map((item) => item.name)
          .join(", ")}`,
      );
    }
  }
}

// Export a singleton instance
export const config = new ConfigService();
