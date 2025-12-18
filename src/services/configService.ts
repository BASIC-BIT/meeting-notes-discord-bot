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

  // Notes generation / testing configuration
  readonly notes = {
    longStoryTestMode: process.env.NOTES_LONG_STORY_TEST_MODE === "true",
    longStoryTargetChars:
      parseInt(process.env.NOTES_LONG_STORY_TARGET_CHARS || "20000", 10) ||
      20000,
  };

  // Live voice configuration
  readonly liveVoice = {
    mode: process.env.LIVE_VOICE_MODE || "off",
    gateModel: process.env.LIVE_VOICE_GATE_MODEL || "gpt-5-mini",
    responderModel: process.env.LIVE_VOICE_RESPONDER_MODEL || "gpt-4o-mini",
    ttsModel: process.env.LIVE_VOICE_TTS_MODEL || "gpt-4o-mini-tts",
    ttsVoice: process.env.LIVE_VOICE_TTS_VOICE || "alloy",
    windowSeconds: parseInt(process.env.LIVE_VOICE_WINDOW_SECONDS || "90", 10),
    windowLines: parseInt(process.env.LIVE_VOICE_WINDOW_LINES || "40", 10),
    pastMeetingsMax: parseInt(
      process.env.LIVE_VOICE_PAST_MEETINGS_MAX || "3",
      10,
    ),
    pastMeetingsMaxChars: parseInt(
      process.env.LIVE_VOICE_PAST_MEETINGS_MAX_CHARS || "400",
      10,
    ),
    gateMaxOutputTokens: parseInt(
      process.env.LIVE_VOICE_GATE_MAX_OUTPUT_TOKENS || "256",
      10,
    ),
    thinkingCue: process.env.LIVE_VOICE_THINKING_CUE !== "false", // default on
    thinkingCueIntervalMs: parseInt(
      process.env.LIVE_VOICE_THINKING_CUE_INTERVAL_MS || "500",
      10,
    ),
  };

  // Ask/Recall configuration
  readonly ask = {
    maxMeetings: parseInt(process.env.ASK_MAX_MEETINGS || "25", 10),
  };

  // Subscription / tier overrides
  readonly subscription = {
    forceTier: process.env.FORCE_TIER || "",
    stripeMode: process.env.STRIPE_MODE || "live",
  };

  // Database Configuration
  readonly database = {
    useLocalDynamoDB:
      process.env.NODE_ENV === "development" &&
      process.env.USE_LOCAL_DYNAMODB === "true",
  };

  // Storage Configuration
  readonly storage = {
    transcriptBucket: process.env.TRANSCRIPTS_BUCKET,
    transcriptPrefix: process.env.TRANSCRIPTS_PREFIX || "",
    awsRegion: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.STORAGE_ENDPOINT,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
  };

  // Server Configuration
  readonly server = {
    port: parseInt(process.env.PORT || "3001", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    oauthSecret: process.env.OAUTH_SECRET || "",
    oauthEnabled: process.env.ENABLE_OAUTH !== "false",
    onboardingEnabled: process.env.ENABLE_ONBOARDING === "true",
    npmPackageVersion: process.env.npm_package_version || "unknown",
    sessionTtlSeconds: parseInt(
      process.env.SESSION_TTL_SECONDS || `${60 * 60 * 24 * 7}`,
      10,
    ),
    // future: rate limit/budget configs per API route can live here
  };

  readonly stripe = {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    priceBasic: process.env.STRIPE_PRICE_BASIC || "",
    successUrl: process.env.STRIPE_SUCCESS_URL || "",
    cancelUrl: process.env.STRIPE_CANCEL_URL || "",
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL || "",
    billingLandingUrl:
      process.env.BILLING_LANDING_URL ||
      process.env.STRIPE_SUCCESS_URL ||
      process.env.STRIPE_CANCEL_URL ||
      "",
  };

  // Frontend / CORS
  readonly frontend = {
    allowedOrigins: (process.env.FRONTEND_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
      .map((origin) => origin.replace(/\/$/, "")),
    siteUrl:
      process.env.FRONTEND_SITE_URL ||
      (process.env.FRONTEND_ALLOWED_ORIGINS || "").split(",")[0]?.trim() ||
      "",
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

    // Stripe validation (optional unless key provided)
    if (this.stripe.secretKey) {
      required.push(
        { name: "STRIPE_PRICE_BASIC", value: this.stripe.priceBasic },
        { name: "STRIPE_SUCCESS_URL", value: this.stripe.successUrl },
        { name: "STRIPE_CANCEL_URL", value: this.stripe.cancelUrl },
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
