import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  FRAME_SIZE,
  MAX_DISCORD_UPLOAD_SIZE,
  MAX_SNIPPET_LENGTH,
  MINIMUM_TRANSCRIPTION_LENGTH,
  SAMPLE_RATE,
  SILENCE_THRESHOLD,
} from "./constants";
import { AudioFileData, AudioSnippet, ChunkInfo } from "./types/audio";
import { MeetingData } from "./types/meeting-data";
import { EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { PassThrough } from "node:stream";
import { transcribeSnippet } from "./transcription";
import ffmpeg from "fluent-ffmpeg";
import { Client } from "discord.js";
import * as fs from "node:fs";
import path from "node:path";
import { maybeRespondLive } from "./liveVoice";

const TRANSCRIPTION_HEADER =
  `NOTICE: Transcription is automatically generated and may not be perfectly accurate!\n` +
  `-----------------------------------------------------------------------------------\n`;

function generateNewSnippet(userId: string): AudioSnippet {
  return {
    chunks: [],
    timestamp: Date.now(),
    userId,
  };
}

// Handle snippets based on the user speaking
export function updateSnippetsIfNecessary(
  meeting: MeetingData,
  userId: string,
): void {
  let snippet = meeting.audioData.currentSnippets.get(userId);

  if (!snippet) {
    snippet = generateNewSnippet(userId);
    meeting.audioData.currentSnippets.set(userId, snippet);
  } else {
    const elapsedTime = Date.now() - snippet.timestamp;
    if (elapsedTime >= MAX_SNIPPET_LENGTH) {
      startProcessingSnippet(meeting, userId);
      snippet = generateNewSnippet(userId);
      meeting.audioData.currentSnippets.set(userId, snippet);
    }
  }
}

// Start processing a specific user's snippet
export function startProcessingSnippet(meeting: MeetingData, userId: string) {
  const snippet = meeting.audioData.currentSnippets.get(userId);
  if (!snippet) return;

  const audioFileData: AudioFileData = {
    timestamp: snippet.timestamp,
    userId: snippet.userId,
    processing: true,
    audioOnlyProcessing: false, // Audio already written in real-time
  };

  const promises: Promise<void>[] = [];

  if (getAudioDuration(snippet) > MINIMUM_TRANSCRIPTION_LENGTH) {
    promises.push(
      transcribeSnippet(meeting, snippet).then((transcription) => {
        audioFileData.transcript = transcription;
        void maybeRespondLive(meeting, {
          userId: snippet.userId,
          text: transcription,
          timestamp: snippet.timestamp,
        });
      }),
    );
  } else {
    console.log(
      `Snippet less than minimum transcription length, not transcribing: ${snippet.userId} ${snippet.timestamp}`,
    );
  }

  // Audio is now written immediately as it arrives, so we don't need to write it here
  // This prevents duplicate audio and memory buildup for long recordings

  audioFileData.audioOnlyProcessingPromise = Promise.resolve(); // Already processed in real-time

  audioFileData.processingPromise = Promise.all(promises).then(() => {
    audioFileData.processing = false;
  });

  meeting.audioData.audioFiles.push(audioFileData);
  meeting.audioData.currentSnippets.delete(userId); // Remove snippet after processing
}

// Set a timer to process the snippet after SILENCE_THRESHOLD
function setSnippetTimer(meeting: MeetingData, userId: string) {
  const currentTimers =
    meeting.audioData.silenceTimers || new Map<string, NodeJS.Timeout>();

  if (currentTimers.has(userId)) {
    clearTimeout(currentTimers.get(userId)!);
  }

  const timer = setTimeout(() => {
    startProcessingSnippet(meeting, userId);
    currentTimers.delete(userId);
  }, SILENCE_THRESHOLD);

  currentTimers.set(userId, timer);
  meeting.audioData.silenceTimers = currentTimers;
}

export function clearSnippetTimer(meeting: MeetingData, userId: string) {
  const currentTimers =
    meeting.audioData.silenceTimers || new Map<string, NodeJS.Timeout>();

  if (currentTimers.has(userId)) {
    clearTimeout(currentTimers.get(userId)!);
  }

  meeting.audioData.silenceTimers = currentTimers;
}

// Subscribe to a user's voice stream and handle the audio data
export async function subscribeToUserVoice(
  meeting: MeetingData,
  userId: string,
) {
  const opusStream = meeting.connection.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.Manual,
    },
  });

  const opusDecoder = new prism.opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: FRAME_SIZE,
  });

  // Prevent decoder errors (often caused by malformed/partial packets) from crashing the process.
  opusDecoder.on("error", (err: Error) => {
    console.warn(
      `Opus decoder error for user ${userId}: ${err.message}. Dropping corrupted frame.`,
    );
  });

  // Prism's Opus stream can also emit errors; guard those too.
  opusStream.on("error", (err: Error) => {
    console.warn(
      `Opus stream error for user ${userId}: ${err.message}. Continuing.`,
    );
  });

  const decodedStream = opusStream.pipe(opusDecoder);

  decodedStream.on("data", (chunk) => {
    // Immediately write audio to the output stream to prevent memory buildup
    // This ensures audio is saved even for very long recordings
    if (meeting.audioData.audioPassThrough) {
      meeting.audioData.audioPassThrough.write(chunk, (err) => {
        if (err) {
          console.error(`Error writing audio chunk from user ${userId}:`, err);
        }
      });
    }

    // Still maintain snippets for transcription purposes
    // These will be processed and cleared when user stops speaking or after 60 seconds
    updateSnippetsIfNecessary(meeting, userId);

    const snippet = meeting.audioData.currentSnippets.get(userId);
    if (snippet) {
      snippet.chunks.push(chunk);
    }
  });
}

export function userStopTalking(meeting: MeetingData, userId: string) {
  setSnippetTimer(meeting, userId);
}

export async function waitForFinishProcessing(meeting: MeetingData) {
  await Promise.all(
    meeting.audioData.audioFiles.map((fileData) => fileData.processingPromise),
  );
}

export async function waitForAudioOnlyFinishProcessing(meeting: MeetingData) {
  // Audio is now written in real-time, so this just ensures all metadata is updated
  // Keeping this function for compatibility but it essentially returns immediately
  await Promise.all(
    meeting.audioData.audioFiles.map(
      (fileData) => fileData.audioOnlyProcessingPromise || Promise.resolve(),
    ),
  );
}

function getAudioDuration(audio: AudioSnippet): number {
  return (
    audio.chunks.reduce((acc, cur) => acc + cur.length, 0) /
    (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
  );
}

export async function compileTranscriptions(
  client: Client,
  meeting: MeetingData,
): Promise<string> {
  const transcription = meeting.audioData.audioFiles
    .filter((fileData) => fileData.transcript && fileData.transcript.length > 0)
    .map((fileData) => {
      const userTag =
        client.users.cache.get(fileData.userId)?.tag ?? fileData.userId;

      return `[${userTag} @ ${new Date(fileData.timestamp).toLocaleString()}]: ${fileData.transcript}`;
    })
    .join("\n");

  if (transcription.length === 0) {
    return transcription;
  }

  return TRANSCRIPTION_HEADER + transcription;

  //
  // try {
  //   // return TRANSCRIPTION_HEADER + fs.readFileSync("./src/test/test_raw_transcript.txt").toString();
  //   const cleanedUpTranscription = await cleanupTranscription(
  //     meeting,
  //     transcription,
  //   );
  //
  //   const originalTranscriptionLines = transcription.split("\n").length;
  //   const cleanedUpTranscriptionLines = (cleanedUpTranscription || "").split(
  //     "\n",
  //   ).length;
  //   console.log(
  //     `Transcription cleanup succeeded.  Original lines: ${originalTranscriptionLines}, Cleaned up lines: ${cleanedUpTranscriptionLines}`,
  //   );
  //
  //   // If our cleaned up transcription is less than 75% of the lines of the original, assume something went critically wrong
  //   if (
  //     cleanedUpTranscriptionLines <
  //     originalTranscriptionLines * TRANSCRIPTION_CLEANUP_LINES_DIFFERENCE_ISSUE
  //   ) {
  //     console.error("Transcription cleanup failed checks, returning original");
  //
  //     return TRANSCRIPTION_HEADER + transcription;
  //   }
  //
  //   return TRANSCRIPTION_HEADER + cleanedUpTranscription;
  // } catch (e) {
  //   console.error("Transcription cleanup failed, returning original", e);
  //
  //   return TRANSCRIPTION_HEADER + transcription;
  // }
}

export function openOutputFile(meeting: MeetingData) {
  const outputFileName = `./recording_${meeting.guildId}_${meeting.channelId}.mp3`;
  meeting.audioData.outputFileName = outputFileName;

  meeting.audioData.audioPassThrough = new PassThrough();

  meeting.audioData.ffmpegProcess = ffmpeg(meeting.audioData.audioPassThrough)
    .inputOptions([
      "-f s16le", // PCM format
      `-ar ${SAMPLE_RATE}`, // Sample rate
      `-ac ${CHANNELS}`, // Number of audio channels
    ])
    .audioCodec("libmp3lame") // Use LAME codec for MP3
    .outputOptions([
      `-b:a 128k`, // Bitrate for lossy compression
      `-ac ${CHANNELS}`, // Ensure stereo output
      `-ar ${SAMPLE_RATE}`, // Ensure output sample rate
    ])
    .toFormat("mp3") // Output format as MP3
    .on("error", (err) => {
      console.error("ffmpeg error:", err);
    })
    .save(outputFileName);
}

export function closeOutputFile(meeting: MeetingData): Promise<void> {
  return new Promise((resolve) => {
    if (meeting.audioData.audioPassThrough) {
      meeting.audioData.audioPassThrough.end(); // End the PassThrough stream
    }
    if (meeting.audioData.ffmpegProcess) {
      meeting.audioData.ffmpegProcess.on("end", () => {
        console.log(
          `Final MP3 file created as ${meeting.audioData.outputFileName}`,
        );
        resolve();
      });
    }
  });
}

/**
 * Split audio into chunks that are under 25MB
 * @param {string} inputFile - The path to the input MP3 file
 * @param {string} outputDir - The directory to store the output chunks
 * @returns {Promise<ChunkInfo[]>} - An array of chunk info (start, end, file)
 */
export async function splitAudioIntoChunks(
  inputFile: string,
  outputDir: string,
): Promise<ChunkInfo[]> {
  try {
    // Ensure the output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    const stats = await fs.promises.stat(inputFile);
    const totalFileSize = stats.size;

    if (totalFileSize <= MAX_DISCORD_UPLOAD_SIZE) {
      return [
        {
          file: inputFile,
          start: 0,
          end: 0, // TODO: Put real data here
        },
      ];
    }

    const metadata = await new Promise<ffmpeg.FfprobeData>(
      (resolve, reject) => {
        ffmpeg.ffprobe(inputFile, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      },
    );

    const duration = metadata.format.duration || 0; // Total duration in seconds
    const bitRate = (totalFileSize * 8) / duration; // Calculate the bitrate in bits per second

    // Calculate the maximum chunk duration based on the 25MB limit
    const maxChunkDuration = (MAX_DISCORD_UPLOAD_SIZE * 8) / bitRate; // in seconds
    const numChunks = Math.ceil(duration / maxChunkDuration);

    let startTime = 0;
    const chunkPromises: Promise<ChunkInfo>[] = [];

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (let i = 0; i < numChunks; i++) {
      const chunkFileName = path.join(outputDir, `chunk_${i}.mp3`);
      const endTime = Math.min(startTime + maxChunkDuration, duration);

      chunkPromises.push(
        new Promise<ChunkInfo>((resolve, reject) => {
          ffmpeg(inputFile)
            .setStartTime(startTime)
            .setDuration(endTime - startTime)
            .output(chunkFileName)
            .on("end", () => {
              console.log(`Chunk ${i} saved: ${chunkFileName}`);
              resolve({ start: startTime, end: endTime, file: chunkFileName });
            })
            .on("error", (err: Error) => {
              console.error(`Error splitting chunk ${i}: ${err.message}`);
              reject(err);
            })
            .run();
        }),
      );

      startTime += maxChunkDuration;
    }

    return Promise.all(chunkPromises);
  } catch (err) {
    console.error(`Error splitting audio: ${err}`);
    throw err;
  }
}

export function unsubscribeToVoiceUponLeaving(
  meeting: MeetingData,
  userId: string,
) {
  const opusStream = meeting.connection.receiver.subscriptions.get(userId);
  if (opusStream) {
    opusStream.destroy();
  }
  meeting.connection.receiver.subscriptions.delete(userId);
}
