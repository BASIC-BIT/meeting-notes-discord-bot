import { act, renderHook } from "@testing-library/react";
import { useLiveMeetingStream } from "./useLiveMeetingStream";

jest.mock("../services/apiClient", () => ({
  buildApiUrl: (path: string) => path,
}));

class TestEventSource extends EventTarget {
  static latest: TestEventSource;
  onerror: (() => void) | null = null;
  constructor() {
    super();
    TestEventSource.latest = this;
  }
  close() {}
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const originalEventSource = global.EventSource;
beforeEach(() => {
  Object.defineProperty(global, "EventSource", {
    configurable: true,
    value: TestEventSource,
  });
});
afterEach(() => {
  Object.defineProperty(global, "EventSource", {
    configurable: true,
    value: originalEventSource,
  });
});

it("replaces revised segments and removes later-suppressed segments", () => {
  const { result } = renderHook(() =>
    useLiveMeetingStream({
      guildId: "guild",
      meetingId: "meeting",
      enabled: true,
    }),
  );
  const source = TestEventSource.latest;
  const voice = {
    id: "voice-1",
    type: "voice",
    time: "0:10",
    speaker: "Alice",
    text: "A first guess",
  };
  act(() =>
    source.emit("init", {
      meeting: {
        guildId: "guild",
        meetingId: "meeting",
        channelId: "channel",
        channelName: "Meeting",
        startedAt: "2026-01-01T00:00:00Z",
        isAutoRecording: false,
        status: "in_progress",
        attendees: [],
      },
      events: [voice],
    }),
  );
  act(() =>
    source.emit("events", {
      events: [{ ...voice, text: "The corrected words" }],
    }),
  );
  expect(result.current.events).toHaveLength(1);
  expect(result.current.events[0].text).toBe("The corrected words");
  act(() =>
    source.emit("events", { events: [], removedEventIds: ["voice-1"] }),
  );
  expect(result.current.events).toEqual([]);
});

it("retains untouched object identities while inserting late events by numeric offset", () => {
  const { result } = renderHook(() =>
    useLiveMeetingStream({
      guildId: "guild",
      meetingId: "meeting",
      enabled: true,
    }),
  );
  const source = TestEventSource.latest;
  const voice = {
    id: "voice-late",
    type: "voice",
    time: "1:40",
    offsetSeconds: 100,
    speaker: "Alice",
    text: "late words",
  };
  act(() => source.emit("events", { events: [voice] }));
  const retained = result.current.events[0];
  act(() =>
    source.emit("events", {
      events: [
        {
          ...voice,
          id: "voice-early",
          time: "0:09",
          offsetSeconds: 9,
          text: "earlier words",
        },
      ],
    }),
  );
  expect(result.current.events.map((event) => event.id)).toEqual([
    "voice-early",
    "voice-late",
  ]);
  expect(result.current.events[1]).toBe(retained);
  const early = result.current.events[0];
  act(() =>
    source.emit("events", { events: [], removedEventIds: ["voice-late"] }),
  );
  expect(result.current.events).toEqual([early]);
  expect(result.current.events[0]).toBe(early);
});
