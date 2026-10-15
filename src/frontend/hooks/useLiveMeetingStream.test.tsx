import { act, renderHook } from "@testing-library/react";
import { useLiveMeetingStream, toStreamStatus } from "./useLiveMeetingStream";
jest.mock("../services/apiClient", () => ({
  buildApiUrl: (path: string) => path,
}));
const sources: FixtureSource[] = [];
class FixtureSource extends EventTarget {
  onerror: (() => void) | null = null;
  close = jest.fn();
  constructor() {
    super();
    sources.push(this);
  }
  emit(status: string) {
    this.dispatchEvent(
      new MessageEvent("init", {
        data: JSON.stringify({
          meeting: {
            guildId: "g",
            meetingId: "m",
            channelId: "c",
            channelName: "Generated",
            startedAt: "2026-01-01T00:00:00Z",
            status,
            attendees: [],
          },
          events: [],
        }),
      }),
    );
  }
}
beforeEach(() => {
  sources.length = 0;
  Object.defineProperty(globalThis, "EventSource", {
    value: FixtureSource,
    configurable: true,
  });
});
test("liveOwnerMissingDoesNotRenderComplete and status can be rechecked", () => {
  const hook = renderHook(() =>
    useLiveMeetingStream({ guildId: "g", meetingId: "m", enabled: true }),
  );
  act(() => sources[0].emit("unavailable"));
  expect(hook.result.current.status).toBe("unavailable");
  expect(hook.result.current.meeting).not.toHaveProperty("endedAt");
  expect(sources[0].close).toHaveBeenCalled();
  act(() => sources[0].onerror?.());
  expect(hook.result.current.status).toBe("unavailable");
  act(() => hook.result.current.retry());
  act(() => sources[1].emit("in_progress"));
  expect(hook.result.current.status).toBe("live");
});
test("known interrupted and failed recordings stop the live state", () => {
  expect(toStreamStatus("interrupted")).toBe("interrupted");
  expect(toStreamStatus("failed")).toBe("failed");
  expect(toStreamStatus("starting")).toBe("starting");
  expect(toStreamStatus("complete")).toBe("complete");
});
