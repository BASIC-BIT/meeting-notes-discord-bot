/** @jest-environment node */
import { getAllMeetings } from "../../src/meetings";
import { shutdownAnalytics } from "../../src/services/analyticsService";
import { shutdownSpeechDetector } from "../../src/services/speechDetectionService";

jest.mock("../../src/meetings", () => ({ getAllMeetings: jest.fn(() => []) }));
jest.mock("../../src/services/analyticsService", () => ({
  captureEvent: jest.fn(),
  shutdownAnalytics: jest.fn(async () => {}),
}));
jest.mock("../../src/services/speechDetectionService", () => ({
  shutdownSpeechDetector: jest.fn(async () => {}),
}));

it("waits for ongoing meeting finalization before detector shutdown and exit at SIGTERM owner", async () => {
  const before = process.listeners("SIGTERM");
  const events: string[] = [];
  let finish = () => {};
  const isFinished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  // Only the completion promise is consumed by the shutdown owner.
  jest
    .mocked(getAllMeetings)
    .mockReturnValue([{ isFinished }] as ReturnType<typeof getAllMeetings>);
  jest.mocked(shutdownSpeechDetector).mockImplementation(async () => {
    events.push("detector");
  });
  jest.mocked(shutdownAnalytics).mockImplementation(async () => {
    events.push("analytics");
  });
  const exit = jest.spyOn(process, "exit").mockImplementation(() => {
    events.push("exit");
    throw Error("test exit");
  });
  try {
    await import("../../src/bot");
    const handler = process
      .listeners("SIGTERM")
      .find((listener) => !before.includes(listener));
    if (!handler) throw Error("No SIGTERM handler registered");
    const pending = handler("SIGTERM");
    await Promise.resolve();
    expect(events).toEqual([]);
    finish();
    await expect(pending).rejects.toThrow("test exit");
    expect(events).toEqual(["detector", "analytics", "exit"]);
  } finally {
    exit.mockRestore();
    for (const listener of process.listeners("SIGTERM"))
      if (!before.includes(listener))
        process.removeListener("SIGTERM", listener);
  }
});
