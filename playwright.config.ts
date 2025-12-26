import { defineConfig, devices } from "@playwright/test";

const reuseServer = process.env.PW_REUSE_SERVER === "true";
const mockEnv = {
  MOCK_MODE: "true",
  ENABLE_OAUTH: "false",
  OPENAI_API_KEY: "test-openai-api-key",
};

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
      timeout: 120_000,
    },
    {
      command: "yarn frontend:dev --host 127.0.0.1 --port 5173",
      url: "http://localhost:5173",
      reuseExistingServer: reuseServer,
      env: {
        ...mockEnv,
        VITE_API_BASE_URL: "http://localhost:3001",
      },
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
