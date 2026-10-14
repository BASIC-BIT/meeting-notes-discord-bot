import type {
  SileroSession,
  SpeechAssessment,
  SpeechMetrics,
  SpeechPolicy,
} from "./speechDetectionTypes";

type DecodedWav = {
  samples: Float32Array;
  monoRms: number;
  strongestChannelRms: number;
};

function readPcmWav(wav: Uint8Array, policy: SpeechPolicy): DecodedWav | null {
  if (wav.length < 12) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (
    view.getUint32(0, false) !== 0x52494646 ||
    view.getUint32(8, false) !== 0x57415645 ||
    view.getUint32(4, true) + 8 !== wav.length
  )
    return null;
  let data: { offset: number; bytes: number } | undefined;
  let channels: number | undefined;
  for (let offset = 12; offset < wav.length;) {
    if (offset + 8 > wav.length) return null;
    const chunkId = view.getUint32(offset, false);
    const chunkBytes = view.getUint32(offset + 4, true);
    const next = offset + 8 + chunkBytes + (chunkBytes % 2);
    if (next > wav.length) return null;
    if (chunkId === 0x666d7420) {
      if (channels !== undefined || chunkBytes < 16) return null;
      channels = view.getUint16(offset + 10, true);
      const blockAlign = view.getUint16(offset + 20, true);
      if (
        view.getUint16(offset + 8, true) !== 1 ||
        channels === 0 ||
        view.getUint32(offset + 12, true) !== policy.sampleRate ||
        view.getUint32(offset + 16, true) !== policy.sampleRate * blockAlign ||
        blockAlign !== channels * 2 ||
        view.getUint16(offset + 22, true) !== 16
      )
        return null;
    } else if (chunkId === 0x64617461) {
      if (data !== undefined) return null;
      data = { offset: offset + 8, bytes: chunkBytes };
    }
    offset = next;
  }
  if (
    channels === undefined ||
    !data ||
    data.bytes === 0 ||
    data.bytes % (channels * 2) !== 0
  )
    return null;
  const samples = new Float32Array(data.bytes / (channels * 2));
  const channelSquares = new Float64Array(channels);
  let monoSquares = 0;
  for (let index = 0; index < samples.length; index++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const sample =
        view.getInt16(data.offset + (index * channels + channel) * 2, true) /
        32768;
      sum += sample;
      channelSquares[channel] += sample * sample;
    }
    samples[index] = sum / channels;
    monoSquares += samples[index] * samples[index];
  }
  let strongestChannelRms = 0;
  for (const squares of channelSquares) {
    strongestChannelRms = Math.max(
      strongestChannelRms,
      Math.sqrt(squares / samples.length),
    );
  }
  return {
    samples,
    strongestChannelRms,
    monoRms: Math.sqrt(monoSquares / samples.length),
  };
}

function hasBriefPeakAmbiguity(
  samples: Float32Array,
  peak: number,
  policy: SpeechPolicy,
): boolean {
  if (peak === 0) return false;
  let highSamples = 0;
  let residualRun = 0;
  let longestResidualRun = 0;
  const highThreshold = peak / policy.impulsePeakRatio;
  for (let offset = 0; offset < samples.length; offset += policy.frameSamples) {
    let hasHighSample = false;
    let hasSignal = false;
    const end = Math.min(samples.length, offset + policy.frameSamples);
    for (let index = offset; index < end; index++) {
      const amplitude = Math.abs(samples[index]);
      hasSignal ||= amplitude > 0;
      if (amplitude > highThreshold) {
        hasHighSample = true;
        highSamples++;
        if (highSamples > policy.frameSamples) return false;
      }
    }
    residualRun = hasSignal && !hasHighSample ? residualRun + 1 : 0;
    longestResidualRun = Math.max(longestResidualRun, residualRun);
  }
  // Brief peaks can set a low whole-clip gain that hides sustained quiet signal.
  // This negative-only safeguard does not label the residual signal as speech.
  return highSamples > 0 && longestResidualRun >= policy.minSpeechFrames;
}

export async function assessWavSpeech(
  wav: Uint8Array,
  session: SileroSession,
  policy: SpeechPolicy,
): Promise<SpeechAssessment> {
  const decoded = readPcmWav(wav, policy);
  if (!decoded)
    return {
      kind: "unavailable",
      reason: "invalid_input",
      policyFingerprint: policy.policyFingerprint,
    };
  if (
    decoded.monoRms <
    policy.cancellationRmsRatio * decoded.strongestChannelRms
  ) {
    return {
      kind: "unavailable",
      reason: "channel_cancellation",
      policyFingerprint: policy.policyFingerprint,
    };
  }
  const { samples } = decoded;
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  const gain =
    peak > 0
      ? Math.min(policy.maxGain, 10 ** (policy.targetPeakDbfs / 20) / peak)
      : 1;
  const metrics: SpeechMetrics = {
    peakSpeechProbability: 0,
    maxConsecutiveSpeechFrames: 0,
    scannedFrames: 0,
    totalFrames: Math.ceil(samples.length / policy.frameSamples),
    gain,
  };
  let state: Float32Array = new Float32Array(256);
  const context = new Float32Array(policy.contextSamples);
  let consecutive = 0;
  for (let offset = 0; offset < samples.length; offset += policy.frameSamples) {
    const input = new Float32Array(policy.contextSamples + policy.frameSamples);
    input.set(context);
    for (
      let index = 0;
      index < policy.frameSamples && offset + index < samples.length;
      index++
    ) {
      input[policy.contextSamples + index] = samples[offset + index] * gain;
    }
    let result: Awaited<ReturnType<SileroSession["infer"]>>;
    try {
      result = await session.infer(input, state);
    } catch {
      return {
        kind: "unavailable",
        reason: "worker_error",
        policyFingerprint: policy.policyFingerprint,
      };
    }
    if (
      !Number.isFinite(result.probability) ||
      result.probability < 0 ||
      result.probability > 1 ||
      result.state.length !== 256 ||
      !result.state.every(Number.isFinite)
    )
      return {
        kind: "unavailable",
        reason: "invalid_output",
        policyFingerprint: policy.policyFingerprint,
      };
    state = result.state;
    context.set(input.subarray(policy.frameSamples));
    metrics.scannedFrames++;
    metrics.peakSpeechProbability = Math.max(
      metrics.peakSpeechProbability,
      result.probability,
    );
    consecutive =
      result.probability >= policy.speechThreshold ? consecutive + 1 : 0;
    metrics.maxConsecutiveSpeechFrames = Math.max(
      metrics.maxConsecutiveSpeechFrames,
      consecutive,
    );
  }
  const kind =
    metrics.maxConsecutiveSpeechFrames >= policy.minSpeechFrames
      ? "speech"
      : metrics.peakSpeechProbability < policy.rejectionCeiling &&
          !hasBriefPeakAmbiguity(samples, peak, policy)
        ? "non_speech"
        : "uncertain";
  return { kind, policyFingerprint: policy.policyFingerprint, metrics };
}
