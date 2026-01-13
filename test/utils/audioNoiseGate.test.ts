import { describe, expect, test } from "@jest/globals";
import { evaluateNoiseGate } from "../../src/utils/audioNoiseGate";

const baseConfig = {
  enabled: true,
  windowMs: 20,
  peakDbfs: -45,
  minActiveWindows: 2,
  minPeakAboveNoiseDb: 15,
  applyToFast: true,
  applyToSlow: true,
};

const sampleRate = 48000;
const channels = 2;
const bytesPerSample = 2;

function buildBufferWithPeak(options: {
  windowCount: number;
  windowMs: number;
  activeWindows?: number[];
  amplitude?: number;
}): Buffer {
  const windowFrames = Math.round((options.windowMs / 1000) * sampleRate);
  const windowBytes = windowFrames * channels * bytesPerSample;
  const totalBytes = windowBytes * options.windowCount;
  const buffer = Buffer.alloc(totalBytes);
  const activeWindows = options.activeWindows ?? [];
  const amplitude = options.amplitude ?? 10000;
  for (const windowIndex of activeWindows) {
    const offset = windowIndex * windowBytes;
    if (offset + 1 < buffer.length) {
      buffer.writeInt16LE(amplitude, offset);
    }
  }
  return buffer;
}

describe("evaluateNoiseGate", () => {
  test("suppresses silent audio", () => {
    const buffer = buildBufferWithPeak({ windowCount: 5, windowMs: 20 });
    const result = evaluateNoiseGate(buffer, baseConfig, {
      sampleRate,
      channels,
      bytesPerSample,
    });
    expect(result.shouldTranscribe).toBe(false);
  });

  test("allows snippets with clear peaks", () => {
    const buffer = buildBufferWithPeak({
      windowCount: 5,
      windowMs: 20,
      activeWindows: [2],
      amplitude: 12000,
    });
    const result = evaluateNoiseGate(buffer, baseConfig, {
      sampleRate,
      channels,
      bytesPerSample,
    });
    expect(result.shouldTranscribe).toBe(true);
  });

  test("suppresses very low peaks with insufficient active windows", () => {
    const buffer = buildBufferWithPeak({
      windowCount: 5,
      windowMs: 20,
      activeWindows: [1],
      amplitude: 100,
    });
    const result = evaluateNoiseGate(buffer, baseConfig, {
      sampleRate,
      channels,
      bytesPerSample,
    });
    expect(result.shouldTranscribe).toBe(false);
  });
});
