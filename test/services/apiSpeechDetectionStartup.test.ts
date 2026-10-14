/** @jest-environment node */
import { setupWebServer } from "../../src/webserver";
import { config } from "../../src/services/configService";

jest.mock("../../src/webserver", () => ({ setupWebServer: jest.fn() }));
jest.mock("../../src/services/langfusePromptService", () => ({
  verifyLangfusePrompts: jest.fn(async () => {}),
}));
jest.mock("../../src/services/tempFileService", () => ({
  cleanupTempBaseDir: jest.fn(async () => {}),
}));
jest.mock("../../src/observability/langfuseInstrumentation", () => ({}));

it("bootstraps API-only with the real bot import without starting a detector worker or loading ONNX", async () => {
  const workerSpawn = jest.fn(() => {
    throw Error("Unexpected detector worker");
  });
  const runtimeLoad = jest.fn(() => {
    throw Error("Unexpected ONNX import");
  });
  jest.doMock("node:worker_threads", () => ({ Worker: workerSpawn }));
  jest.doMock("onnxruntime-web", runtimeLoad);
  const previousMockMode = config.mock.enabled;
  const before = process.listeners("SIGTERM");
  try {
    config.mock.enabled = false;
    const { bootstrapApp } = await import("../../src/apps/bootstrap");
    await bootstrapApp("api");
    expect(setupWebServer).toHaveBeenCalledTimes(1);
    expect(workerSpawn).not.toHaveBeenCalled();
    expect(runtimeLoad).not.toHaveBeenCalled();
  } finally {
    config.mock.enabled = previousMockMode;
    jest.dontMock("node:worker_threads");
    jest.dontMock("onnxruntime-web");
    for (const listener of process.listeners("SIGTERM"))
      if (!before.includes(listener))
        process.removeListener("SIGTERM", listener);
  }
});
