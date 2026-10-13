/** @jest-environment node */
jest.mock("../../src/observability/langfuseInstrumentation", () => ({}));
jest.mock("../../src/voiceUdpGuard", () => ({}));
jest.mock("../../src/ipv4first", () => ({}));
jest.mock("../../src/bot", () => ({
  setupBot: jest.fn(),
  isBotGatewayReady: jest.fn(() => false),
}));
jest.mock("../../src/webserver", () => ({ setupWebServer: jest.fn() }));
jest.mock("../../src/services/configService", () => ({
  config: { mock: { enabled: false } },
}));
jest.mock("../../src/services/langfusePromptService", () => ({
  verifyLangfusePrompts: jest.fn(),
}));
jest.mock("../../src/services/tempFileService", () => ({
  cleanupTempBaseDir: jest.fn(),
}));
jest.mock("../../src/services/runtimeStartupService", () => ({
  initializeRuntimeLifecycle: jest.fn(),
}));
import { bootstrapApp } from "../../src/apps/bootstrap";
import { setupBot } from "../../src/bot";
import { setupWebServer } from "../../src/webserver";
import { initializeRuntimeLifecycle } from "../../src/services/runtimeStartupService";

beforeEach(() => jest.clearAllMocks());

test("gateway login failure cannot publish ready startup", async () => {
  const ready = jest.fn();
  const failed = jest.fn();
  jest.mocked(initializeRuntimeLifecycle).mockResolvedValue({ ready, failed });
  jest.mocked(setupBot).mockRejectedValue(new Error("login failed"));
  await expect(bootstrapApp("all")).rejects.toThrow("login failed");
  expect(ready).not.toHaveBeenCalled();
  expect(setupWebServer).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
});

test("startup waits for gateway login after establishing protection", async () => {
  let finish!: () => void;
  const login = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let started!: () => void;
  const loginStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const ready = jest.fn();
  const failed = jest.fn();
  jest.mocked(initializeRuntimeLifecycle).mockResolvedValue({ ready, failed });
  jest.mocked(setupBot).mockImplementation(async () => {
    started();
    await login;
  });
  const boot = bootstrapApp("all");
  await loginStarted;
  expect(initializeRuntimeLifecycle).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
  expect(setupWebServer).not.toHaveBeenCalled();
  finish();
  await boot;
  expect(ready).toHaveBeenCalledTimes(1);
});

test("API-only mode has no gateway login dependency", async () => {
  const ready = jest.fn();
  jest
    .mocked(initializeRuntimeLifecycle)
    .mockImplementation(async (gatewayReady) => {
      expect(gatewayReady()).toBe(false);
      return { ready, failed: jest.fn() };
    });
  await bootstrapApp("api");
  expect(setupBot).not.toHaveBeenCalled();
  expect(setupWebServer).toHaveBeenCalledTimes(1);
  expect(ready).toHaveBeenCalledTimes(1);
});
