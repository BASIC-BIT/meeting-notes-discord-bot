// Exercise real configuration and repository factories without reading a host .env.
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

Object.assign(process.env, {
  MOCK_MODE: "false",
  DISCORD_BOT_TOKEN: "deployment-integration-dummy",
  DISCORD_CLIENT_ID: "deployment-integration-dummy",
  OPENAI_API_KEY: "deployment-integration-dummy",
  FRONTEND_SITE_URL: "http://localhost",
  SESSION_SECRET: "deployment-integration-dummy",
  OAUTH_SECRET: "",
  ENABLE_OAUTH: "false",
  ENABLE_MCP: "false",
  LANGFUSE_PUBLIC_KEY: "",
  LANGFUSE_SECRET_KEY: "",
  LANGFUSE_TRACING_ENABLED: "false",
  STRIPE_SECRET_KEY: "",
  APP_CONFIG_ENABLED: "false",
  POSTHOG_KEY: "",
  CACHE_ENABLED: "false",
  ECS_CONTAINER_METADATA_URI_V4: "",
  ECS_AGENT_URI: "",
  AWS_EXECUTION_ENV: "",
  AWS_EC2_METADATA_DISABLED: "true",
});
