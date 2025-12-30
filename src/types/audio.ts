import { FfmpegCommand } from "fluent-ffmpeg";
import { PassThrough } from "node:stream";

export interface AudioSnippet {
  chunks: Buffer[];
  timestamp: number;
  userId: string;
  audioFileData?: AudioFileData;
  fastRevision?: number;
  fastTranscribed?: boolean;
}

export type AudioSegmentSource = "voice" | "chat_tts" | "bot";
export interface AudioCueEvent {
  userId: string;
  timestamp: number;
  text: string;
  source?: AudioSegmentSource;
}

export interface AudioFileData {
  userId: string;
  timestamp: number;
  transcript?: string;
  source?: AudioSegmentSource;
  messageId?: string;
  processing: boolean;
  processingPromise?: Promise<void>;
  audioOnlyProcessing: boolean; //Is just the audio finished (don't worry about transcriptions which may be slower)
  audioOnlyProcessingPromise?: Promise<void>;
}

export interface AudioSegmentFile {
  filePath: string;
  offsetMs: number;
  durationMs: number;
  userId: string;
  source?: AudioSegmentSource;
}

export interface AudioData {
  currentSnippets: Map<string, AudioSnippet>; // Map of userId to their current AudioSnippet
  silenceTimers?: Map<string, { fast?: NodeJS.Timeout; slow?: NodeJS.Timeout }>; // Optional: Map of userId to their silence timers
  audioFiles: AudioFileData[];
  cueEvents?: AudioCueEvent[];
  audioPassThrough?: PassThrough;
  outputFileName?: string;
  ffmpegProcess?: FfmpegCommand;
  audioSegments?: AudioSegmentFile[];
  segmentWritePromises?: Promise<void>[];
  segmentDir?: string;
}

export interface ChunkInfo {
  start: number;
  end: number;
  file: string;
}
