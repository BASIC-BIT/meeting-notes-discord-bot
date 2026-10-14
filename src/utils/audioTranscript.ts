import type { AudioData, AudioFileData } from "../types/audio";
import type { TranscriptionFacts } from "../types/meetingProcessing";
import { isTrivialTranscriptionText } from "./transcriptionText";

export function isAudioFileSpeechRejected(file: AudioFileData): boolean {
  return file.finalSpeechRejection !== undefined;
}

export function resolveAudioFileText(file: AudioFileData): string {
  if (isAudioFileSpeechRejected(file)) return "";
  const text =
    file.finalPassTranscript !== undefined
      ? file.finalPassTranscript
      : file.coalescedTranscript ||
        file.slowTranscript ||
        file.transcript ||
        file.fastTranscripts?.at(-1)?.text ||
        "";
  return isTrivialTranscriptionText(text) ? "" : text.trim();
}

export function getAudioTranscriptionFacts(
  audio: AudioData,
): TranscriptionFacts {
  const files = audio.audioFiles.filter((file) => file.source !== "bot");
  return {
    usableSegments: files.filter((file) => Boolean(resolveAudioFileText(file)))
      .length,
    failedSegments: files.filter(
      (file) => !isAudioFileSpeechRejected(file) && file.transcriptionFailed,
    ).length,
    captureIncomplete: audio.captureIncomplete ?? false,
  };
}
