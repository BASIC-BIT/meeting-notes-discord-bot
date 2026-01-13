import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  NOISE_GATE_NOISE_FLOOR_PERCENTILE,
  RECORD_SAMPLE_RATE,
} from "../constants";
import type { MeetingRuntimeConfig } from "../config/types";

export type NoiseGateConfig =
  MeetingRuntimeConfig["transcription"]["noiseGate"];

export type NoiseGateMetrics = {
  windowMs: number;
  totalWindows: number;
  peakDbfs: number;
  noiseFloorDbfs: number;
  activeWindowCount: number;
  minActiveWindows: number;
  minPeakAboveNoiseDb: number;
  thresholdDbfs: number;
};

const INT16_MAX = 32768;

function toDbfs(peak: number): number {
  if (peak <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(peak / INT16_MAX);
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction)),
  );
  return sorted[index];
}

export function evaluateNoiseGate(
  buffer: Buffer,
  config: NoiseGateConfig,
  options: {
    sampleRate?: number;
    channels?: number;
    bytesPerSample?: number;
  } = {},
): { shouldTranscribe: boolean; metrics: NoiseGateMetrics } {
  const sampleRate = options.sampleRate ?? RECORD_SAMPLE_RATE;
  const channels = options.channels ?? CHANNELS;
  const bytesPerSample = options.bytesPerSample ?? BYTES_PER_SAMPLE;
  const bytesPerFrame = Math.max(1, channels * bytesPerSample);
  const windowMs = Math.max(1, config.windowMs);
  const windowFrames = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const windowBytes = Math.max(bytesPerFrame, windowFrames * bytesPerFrame);
  const usableLength = buffer.length - (buffer.length % bytesPerSample);

  if (usableLength <= 0) {
    return {
      shouldTranscribe: true,
      metrics: {
        windowMs,
        totalWindows: 0,
        peakDbfs: Number.NEGATIVE_INFINITY,
        noiseFloorDbfs: Number.NEGATIVE_INFINITY,
        activeWindowCount: 0,
        minActiveWindows: config.minActiveWindows,
        minPeakAboveNoiseDb: config.minPeakAboveNoiseDb,
        thresholdDbfs: config.peakDbfs,
      },
    };
  }

  const windowPeaks: number[] = [];
  let overallPeak = 0;

  for (let offset = 0; offset < usableLength; offset += windowBytes) {
    const end = Math.min(offset + windowBytes, usableLength);
    let windowPeak = 0;
    for (let index = offset; index + 1 < end; index += 2) {
      const sample = buffer.readInt16LE(index);
      const abs = sample < 0 ? -sample : sample;
      if (abs > windowPeak) {
        windowPeak = abs;
      }
    }
    windowPeaks.push(windowPeak);
    if (windowPeak > overallPeak) {
      overallPeak = windowPeak;
    }
  }

  const windowPeaksDb = windowPeaks.map((peak) => toDbfs(peak));
  const peakDbfs = toDbfs(overallPeak);
  const noiseFloorDbfs = percentile(
    windowPeaksDb,
    NOISE_GATE_NOISE_FLOOR_PERCENTILE,
  );
  const activeWindowCount = windowPeaksDb.filter(
    (db) => db > noiseFloorDbfs + config.minPeakAboveNoiseDb,
  ).length;

  const isSilentByPeak = peakDbfs <= config.peakDbfs;
  const isSilentByActivity = activeWindowCount < config.minActiveWindows;
  const shouldTranscribe = !(isSilentByPeak && isSilentByActivity);

  return {
    shouldTranscribe,
    metrics: {
      windowMs,
      totalWindows: windowPeaksDb.length,
      peakDbfs,
      noiseFloorDbfs,
      activeWindowCount,
      minActiveWindows: config.minActiveWindows,
      minPeakAboveNoiseDb: config.minPeakAboveNoiseDb,
      thresholdDbfs: config.peakDbfs,
    },
  };
}
