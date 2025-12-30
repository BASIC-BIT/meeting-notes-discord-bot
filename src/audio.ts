import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  FAST_SILENCE_THRESHOLD,
  FRAME_SIZE,
  MAX_DISCORD_UPLOAD_SIZE,
  MAX_SNIPPET_LENGTH,
  MINIMUM_TRANSCRIPTION_LENGTH,
  RECORD_SAMPLE_RATE,
  SILENCE_THRESHOLD,
} from "./constants";
import {
  AudioFileData,
  AudioSegmentFile,
  AudioSnippet,
  ChunkInfo,
} from "./types/audio";
import { MeetingData } from "./types/meeting-data";
import { EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { PassThrough } from "node:stream";
import { transcribeSnippet } from "./transcription";
import { formatParticipantLabel } from "./utils/participants";
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
    fastRevision: 0,
    fastTranscribed: false,
  };
}

type SnippetProcessingOptions = {
  forceTranscribe?: boolean;
  skipLiveVoice?: boolean;
};

type SnippetTimers = {
  fast?: NodeJS.Timeout;
  slow?: NodeJS.Timeout;
};

function cloneSnippet(snippet: AudioSnippet): AudioSnippet {
  return {
    ...snippet,
    chunks: [...snippet.chunks],
  };
}

function getSegmentDir(meeting: MeetingData): string {
  if (meeting.audioData.segmentDir) {
    return meeting.audioData.segmentDir;
  }
  const dir = path.resolve(
    process.cwd(),
    `segments_${meeting.guildId}_${meeting.channelId}_${meeting.meetingId}`,
  );
  meeting.audioData.segmentDir = dir;
  return dir;
}

function trackSegmentWrite(meeting: MeetingData, promise: Promise<void>) {
  if (!meeting.audioData.segmentWritePromises) {
    meeting.audioData.segmentWritePromises = [];
  }
  meeting.audioData.segmentWritePromises.push(promise);
}

async function persistSnippetAudioSegment(
  meeting: MeetingData,
  snippet: AudioSnippet,
) {
  if (snippet.chunks.length === 0) return;

  const buffer = Buffer.concat(snippet.chunks);
  const durationMs = Math.round(
    (buffer.length / (RECORD_SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)) * 1000,
  );
  if (durationMs <= 0) return;

  const offsetMs = Math.max(0, snippet.timestamp - meeting.startTime.getTime());
  const dir = getSegmentDir(meeting);
  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(
    dir,
    `segment_${snippet.userId}_${snippet.timestamp}.pcm`,
  );

  const writePromise = fs.promises
    .writeFile(filePath, buffer)
    .catch((error) => {
      console.error(
        `Failed to persist audio segment for user ${snippet.userId}:`,
        error,
      );
    }) as Promise<void>;

  trackSegmentWrite(meeting, writePromise);

  const segment: AudioSegmentFile = {
    filePath,
    offsetMs,
    durationMs,
    userId: snippet.userId,
    source: "voice",
  };
  if (!meeting.audioData.audioSegments) {
    meeting.audioData.audioSegments = [];
  }
  meeting.audioData.audioSegments.push(segment);
}

function getOrCreateAudioFileData(
  meeting: MeetingData,
  snippet: AudioSnippet,
): AudioFileData {
  if (snippet.audioFileData) {
    return snippet.audioFileData;
  }

  const audioFileData: AudioFileData = {
    timestamp: snippet.timestamp,
    userId: snippet.userId,
    source: "voice",
    processing: true,
    audioOnlyProcessing: false, // Audio already written in real-time
  };

  audioFileData.audioOnlyProcessingPromise = Promise.resolve();

  meeting.audioData.audioFiles.push(audioFileData);
  snippet.audioFileData = audioFileData;

  return audioFileData;
}

function runFastTranscription(meeting: MeetingData, snippet: AudioSnippet) {
  if (snippet.chunks.length === 0) return;

  const duration = getAudioDuration(snippet);
  if (duration <= MINIMUM_TRANSCRIPTION_LENGTH) {
    return;
  }

  const audioFileData = getOrCreateAudioFileData(meeting, snippet);
  const revision = (snippet.fastRevision ?? 0) + 1;
  snippet.fastRevision = revision;

  const snapshot = cloneSnippet(snippet);
  void transcribeSnippet(meeting, snapshot, {
    tempSuffix: `fast-${revision}`,
  })
    .then((transcription) => {
      if (snippet.fastRevision !== revision) return;
      if (!transcription.trim() || transcription === "[Transcription failed]") {
        return;
      }
      audioFileData.transcript = transcription;
      snippet.fastTranscribed = true;
      void maybeRespondLive(meeting, {
        userId: snippet.userId,
        text: transcription,
        timestamp: snippet.timestamp,
      });
    })
    .catch((error) => {
      console.error(
        `Failed to transcribe fast snippet for user ${snippet.userId}:`,
        error,
      );
    });
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
export function startProcessingSnippet(
  meeting: MeetingData,
  userId: string,
  options: SnippetProcessingOptions = {},
) {
  const snippet = meeting.audioData.currentSnippets.get(userId);
  if (!snippet) return;

  void persistSnippetAudioSegment(meeting, snippet);
  snippet.fastRevision = (snippet.fastRevision ?? 0) + 1;

  const audioFileData = getOrCreateAudioFileData(meeting, snippet);
  audioFileData.processing = true;

  const promises: Promise<void>[] = [];

  const duration = getAudioDuration(snippet);
  const hasAudio = snippet.chunks.length > 0;
  if (
    hasAudio &&
    (duration > MINIMUM_TRANSCRIPTION_LENGTH || options.forceTranscribe)
  ) {
    promises.push(
      transcribeSnippet(meeting, snippet).then((transcription) => {
        audioFileData.transcript = transcription;
        if (!options.skipLiveVoice) {
          void maybeRespondLive(meeting, {
            userId: snippet.userId,
            text: transcription,
            timestamp: snippet.timestamp,
          });
        }
      }),
    );
  } else {
    console.log(
      `Snippet less than minimum transcription length, not transcribing: ${snippet.userId} ${snippet.timestamp}`,
    );
  }

  // Audio is now written immediately as it arrives, so we don't need to write it here
  // This prevents duplicate audio and memory buildup for long recordings

  audioFileData.processingPromise = Promise.all(promises).then(() => {
    audioFileData.processing = false;
  });

  meeting.audioData.currentSnippets.delete(userId); // Remove snippet after processing
}

// Set timers to run fast transcription and finalize the snippet after silence
function setSnippetTimer(meeting: MeetingData, userId: string) {
  const currentTimers =
    meeting.audioData.silenceTimers || new Map<string, SnippetTimers>();
  const existing = currentTimers.get(userId) ?? {};

  if (existing.fast) {
    clearTimeout(existing.fast);
  }
  if (existing.slow) {
    clearTimeout(existing.slow);
  }

  existing.fast = setTimeout(() => {
    const snippet = meeting.audioData.currentSnippets.get(userId);
    if (!snippet) return;
    runFastTranscription(meeting, snippet);
    const next = currentTimers.get(userId);
    if (next) {
      next.fast = undefined;
    }
  }, FAST_SILENCE_THRESHOLD);

  existing.slow = setTimeout(() => {
    const snippet = meeting.audioData.currentSnippets.get(userId);
    if (!snippet) {
      currentTimers.delete(userId);
      return;
    }
    startProcessingSnippet(meeting, userId, {
      skipLiveVoice: Boolean(snippet.fastTranscribed),
    });
    currentTimers.delete(userId);
  }, SILENCE_THRESHOLD);

  currentTimers.set(userId, existing);
  meeting.audioData.silenceTimers = currentTimers;
}

export function clearSnippetTimer(meeting: MeetingData, userId: string) {
  const currentTimers =
    meeting.audioData.silenceTimers || new Map<string, SnippetTimers>();
  const existing = currentTimers.get(userId);

  if (existing?.fast) {
    clearTimeout(existing.fast);
  }
  if (existing?.slow) {
    clearTimeout(existing.slow);
  }

  currentTimers.delete(userId);
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
    rate: RECORD_SAMPLE_RATE,
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
  const pending = meeting.liveVoiceCommandPending;
  if (pending && pending.expiresAt > Date.now() && pending.userId === userId) {
    clearSnippetTimer(meeting, userId);
    startProcessingSnippet(meeting, userId, { forceTranscribe: true });
    return;
  }
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
    (RECORD_SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
  );
}

export async function compileTranscriptions(
  client: Client,
  meeting: MeetingData,
  options: { includeCues?: boolean } = {},
): Promise<string> {
  const segments = meeting.audioData.audioFiles
    .filter((fileData) => fileData.transcript && fileData.transcript.length > 0)
    .map((fileData) => ({
      userId: fileData.userId,
      timestamp: fileData.timestamp,
      text: fileData.transcript ?? "",
    }));

  if (options.includeCues && meeting.audioData.cueEvents) {
    for (const cue of meeting.audioData.cueEvents) {
      if (!cue.text) continue;
      segments.push({
        userId: cue.userId,
        timestamp: cue.timestamp,
        text: cue.text,
      });
    }
  }

  segments.sort((a, b) => a.timestamp - b.timestamp);

  const transcription = segments
    .map((segment) => {
      const participant = meeting.participants.get(segment.userId);
      const member = meeting.guild.members.cache.get(segment.userId);
      const user = client.users.cache.get(segment.userId);
      const fallbackName =
        member?.nickname ||
        member?.user.globalName ||
        member?.user.username ||
        user?.globalName ||
        user?.username ||
        segment.userId;
      const fallbackUsername =
        member?.user.username || user?.username || undefined;
      const speakerLabel = formatParticipantLabel(participant, {
        includeUsername: true,
        fallbackName,
        fallbackUsername,
      });

      return `[${speakerLabel} @ ${new Date(
        segment.timestamp,
      ).toLocaleString()}]: ${segment.text}`;
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
      `-ar ${RECORD_SAMPLE_RATE}`, // Sample rate
      `-ac ${CHANNELS}`, // Number of audio channels
    ])
    .audioCodec("libmp3lame") // Use LAME codec for MP3
    .outputOptions([
      `-b:a 128k`, // Bitrate for lossy compression
      `-ac ${CHANNELS}`, // Ensure stereo output
      `-ar ${RECORD_SAMPLE_RATE}`, // Ensure output sample rate
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

async function waitForSegmentWrites(meeting: MeetingData) {
  const writes = meeting.audioData.segmentWritePromises;
  if (!writes || writes.length === 0) return;
  await Promise.all(writes);
}

export async function buildMixedAudio(
  meeting: MeetingData,
): Promise<string | undefined> {
  const segments = meeting.audioData.audioSegments ?? [];
  if (segments.length < 2) return undefined;

  await waitForSegmentWrites(meeting);

  const usable = segments.filter(
    (segment) => segment.durationMs > 0 && fs.existsSync(segment.filePath),
  );
  if (usable.length < 2) return undefined;

  const outputFileName = `./recording_${meeting.guildId}_${meeting.channelId}_${meeting.meetingId}_mixed.mp3`;

  return await new Promise<string | undefined>((resolve) => {
    const command = ffmpeg();

    usable.forEach((segment) => {
      command
        .input(segment.filePath)
        .inputOptions([
          "-f s16le",
          `-ar ${RECORD_SAMPLE_RATE}`,
          `-ac ${CHANNELS}`,
        ]);
    });

    const filterParts = usable.map((segment, index) => {
      const delay = Math.max(0, Math.round(segment.offsetMs));
      return `[${index}:a]adelay=${delay}|${delay}[a${index}]`;
    });
    const mixInputs = usable.map((_segment, index) => `[a${index}]`).join("");
    const filter = `${filterParts.join(";")};${mixInputs}amix=inputs=${usable.length}:dropout_transition=0:normalize=0[mixed]`;

    command
      .complexFilter(filter)
      .outputOptions([
        "-map [mixed]",
        `-b:a 128k`,
        `-ac ${CHANNELS}`,
        `-ar ${RECORD_SAMPLE_RATE}`,
      ])
      .audioCodec("libmp3lame")
      .on("error", (err) => {
        console.error("Failed to render mixed audio:", err);
        resolve(undefined);
      })
      .on("end", () => {
        resolve(outputFileName);
      })
      .save(outputFileName);
  });
}

export async function cleanupAudioSegments(
  meeting: MeetingData,
): Promise<void> {
  const dir = meeting.audioData.segmentDir;
  if (!dir) return;
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to clean up audio segment files:", error);
  }
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
