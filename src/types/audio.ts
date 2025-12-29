import { FfmpegCommand } from "fluent-ffmpeg";
import { PassThrough } from "node:stream";

export interface AudioSnippet {
  chunks: Buffer[];
  timestamp: number;
  userId: string;
}

export type AudioSegmentSource = "voice" | "chat_tts" | "bot";

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

export interface AudioData {
  currentSnippets: Map<string, AudioSnippet>; // Map of userId to their current AudioSnippet
  silenceTimers?: Map<string, NodeJS.Timeout>; // Optional: Map of userId to their silence timer
  audioFiles: AudioFileData[];
  audioPassThrough?: PassThrough;
  outputFileName?: string;
  ffmpegProcess?: FfmpegCommand;
}

export interface ChunkInfo {
  start: number;
  end: number;
  file: string;
}
