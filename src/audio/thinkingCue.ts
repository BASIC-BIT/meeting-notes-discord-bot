import { Readable } from "node:stream";
import { StreamType, createAudioResource } from "@discordjs/voice";

/**
 * Generate a very short, low-friction "droplet" thinking cue.
 * Shape: ~150ms upward chirp with soft attack/decay.
 */
export function buildThinkingCueResource() {
  const sampleRate = 48000;
  const totalMs = 180;
  const samples = Math.floor((totalMs / 1000) * sampleRate);
  const buffer = Buffer.alloc(samples * 2 * 2); // stereo 16-bit

  // Two very short, noise-based drops to keep it less tonal
  const drops = [
    { startMs: 0, durationMs: 35 },
    { startMs: 200, durationMs: 35 },
  ];

  for (const drop of drops) {
    const start = Math.floor((drop.startMs / 1000) * sampleRate);
    const len = Math.floor((drop.durationMs / 1000) * sampleRate);
    const fadeIn = Math.floor((3 / 1000) * sampleRate);
    const fadeOut = Math.floor((22 / 1000) * sampleRate);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= samples) break;
      // White noise sample
      let s = Math.random() * 2 - 1;
      if (i < fadeIn) s *= i / fadeIn;
      if (len - i < fadeOut) s *= (len - i) / fadeOut;

      // very low level to keep it subtle
      const val = Math.max(-32767, Math.min(32767, s * 0.1 * 32767));
      const offset = idx * 4;
      buffer.writeInt16LE(
        Math.max(-32768, Math.min(32767, buffer.readInt16LE(offset) + val)),
        offset,
      );
      buffer.writeInt16LE(
        Math.max(-32768, Math.min(32767, buffer.readInt16LE(offset + 2) + val)),
        offset + 2,
      );
    }
  }

  return createAudioResource(Readable.from(buffer), {
    inputType: StreamType.Raw,
  });
}
