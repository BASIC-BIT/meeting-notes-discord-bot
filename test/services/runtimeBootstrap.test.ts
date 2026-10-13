/** @jest-environment node */
jest.mock("../../src/observability/langfuseInstrumentation", () => ({}));
jest.mock("../../src/voiceUdpGuard", () => ({}));
jest.mock("../../src/ipv4first", () => ({}));
jest.mock("../../src/bot", () => ({
  setupBot: jest.fn(),
  isBotGatewayReady: jest.fn(() => false),
}));
jest.mock("../../src/webserver", () => ({ setupWebServer: jest.fn() }));
jest.mock("../../src/services/runtimeHealthServer", () => ({
  startRuntimeHealthServer: jest.fn(),
}));
jest.mock("../../src/services/configService", () => ({
  config: {
    mock: { enabled: false },
    runtime: { ecs: false },
    server: { port: 3001 },
  },
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
import { startRuntimeHealthServer } from "../../src/services/runtimeHealthServer";
import { config } from "../../src/services/configService";
import { verifyLangfusePrompts } from "../../src/services/langfusePromptService";

beforeEach(() => {
  jest.clearAllMocks();
  config.runtime.ecs = false;
});

test.each(["all", "bot", "api"] as const)(
  "%s uses one health listener and no application boot before protection",
  async (mode) => {
    config.runtime.ecs = true;
    const health = {
      server: {} as Awaited<
        ReturnType<typeof startRuntimeHealthServer>
      >["server"],
      activate: jest.fn(),
      close: jest.fn(),
    };
    jest.mocked(startRuntimeHealthServer).mockResolvedValue(health);
    let finish!: (
      value: Awaited<ReturnType<typeof initializeRuntimeLifecycle>>,
    ) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const protection = new Promise<
      Awaited<ReturnType<typeof initializeRuntimeLifecycle>>
    >((resolve) => {
      finish = resolve;
    });
    jest.mocked(initializeRuntimeLifecycle).mockImplementation(() => {
      entered();
      return protection;
    });
    jest.mocked(setupBot).mockResolvedValue(undefined);
    const boot = bootstrapApp(mode);
    await waiting;
    expect(startRuntimeHealthServer).toHaveBeenCalledTimes(1);
    expect(setupBot).not.toHaveBeenCalled();
    expect(setupWebServer).not.toHaveBeenCalled();
    expect(verifyLangfusePrompts).not.toHaveBeenCalled();
    const ready = jest.fn();
    finish({ ready, failed: jest.fn() });
    await boot;
    expect(ready).toHaveBeenCalledTimes(1);
    if (mode !== "bot") expect(setupWebServer).toHaveBeenCalledWith(health);
    else expect(setupWebServer).not.toHaveBeenCalled();
  },
);

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
