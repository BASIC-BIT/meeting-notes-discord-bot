/** @jest-environment node */
import { PassThrough } from "node:stream";
import { createCheckpointPlaybackTap } from "../../src/services/recordingCheckpointPlayback";
import { getCheckpointPcmBudget } from "../../src/services/recordingCheckpointCapture";

test("bot prefix follows actual packet consumption, pause and interrupted tail", () => {
  const captured: Array<{ bytes: number; at: number }> = [];
  const tap = createCheckpointPlaybackTap({
    push: (bytes, at) => {
      captured.push({ bytes: bytes.length, at });
      return true;
    },
    stop: jest.fn(),
  });
  const output = new PassThrough();
  tap.stream.pipe(output);
  output.resume();
  tap.stream.write(Buffer.alloc(3840 * 3));
  const resource = {
    playbackDuration: 0,
    read() {
      this.playbackDuration += 20;
      return Buffer.from([1]);
    },
  };
  tap.attach(resource);
  expect(captured).toHaveLength(0);
  resource.read();
  expect(captured).toHaveLength(1);
  expect(captured[0].bytes).toBe(3840);
  // No resource read during pause, no manufactured future coverage.
  expect(captured).toHaveLength(1);
  tap.dispose();
  expect(captured).toHaveLength(1);
  expect(getCheckpointPcmBudget().reservedBytes).toBe(0);
});

test("silence packets cannot consume prefetched PCM", () => {
  const push = jest.fn(() => true);
  const tap = createCheckpointPlaybackTap({ push, stop: jest.fn() });
  const resource = { playbackDuration: 0, read: () => Buffer.from([1]) };
  tap.attach(resource);
  resource.read();
  expect(push).not.toHaveBeenCalled();
  tap.dispose();
});
