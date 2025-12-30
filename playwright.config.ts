import { defineConfig, devices } from "@playwright/test";

const reuseServer = process.env.PW_REUSE_SERVER === "true";
const mockEnv = {
  MOCK_MODE: "true",
  ENABLE_OAUTH: "false",
  OPENAI_API_KEY: "test-openai-api-key",
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_CLIENT_ID: "test-client-id",
  DISCORD_CLIENT_SECRET: "test-client-secret",
  DISCORD_CALLBACK_URL: "http://localhost:3001/auth/discord/callback",
  OAUTH_SECRET: "test-oauth-secret",
  MOCK_FIXED_NOW: "2025-01-01T00:00:00.000Z",
  VITE_MOCK_FIXED_NOW: "2025-01-01T00:00:00.000Z",
};

for (const [key, value] of Object.entries(mockEnv)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "yarn start:mock:once",
      url: "http://localhost:3001/health",
      reuseExistingServer: reuseServer,
      env: mockEnv,
      timeout: 180_000,
    },
    {
      command: "yarn frontend:dev --host 0.0.0.0 --port 5173",
      url: "http://localhost:5173",
      reuseExistingServer: reuseServer,
      env: {
        ...mockEnv,
        // Use Vite's proxy for local E2E to avoid CORS issues.
        VITE_API_BASE_URL: "",
      },
      timeout: 180_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
