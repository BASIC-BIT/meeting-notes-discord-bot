import {
    BYTES_PER_SAMPLE,
    CHANNELS, FRAME_SIZE, MAX_SNIPPET_LENGTH, MINIMUM_TRANSCRIPTION_LENGTH,
    SAMPLE_RATE,
    SILENCE_THRESHOLD
} from "./constants";
import { AudioFileData, AudioSnippet } from "./types/audio";
import { MeetingData } from "./types/meeting-data";
import { EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { PassThrough } from "node:stream";
import { transcribeSnippet } from "./transcription";
import ffmpeg from "fluent-ffmpeg";
import { Client } from "discord.js";

function generateSilentBuffer(durationMs: number, sampleRate: number, channels: number): Buffer {
    const numSamples = Math.floor((durationMs / 1000) * sampleRate) * channels;
    return Buffer.alloc(numSamples * BYTES_PER_SAMPLE);
}

function generateNewSnippet(userId: string): AudioSnippet {
    return {
        chunks: [],
        timestamp: Date.now(),
        userId,
    };
}

// Create a new snippet if a new user is talking or if there was over 5 seconds of silence,
// otherwise returns the existing one to continue to capture data.
// Generates silence since the last received packet.
function updateSnippetsIfNecessary(meeting: MeetingData, userId: string): void {
    const prevSnippet = meeting.audioData.currentSnippet;

    // If this is our first snippet, generate a new one and stop.
    if (!prevSnippet) {
        meeting.audioData.currentSnippet = generateNewSnippet(userId);
        return;
    }

    // If a new user is speaking, process current snippet and stop.
    if (prevSnippet.userId !== userId) {
        startProcessingCurrentSnippet(meeting, userId);
        return;
    }

    // If it's been too long with the same snippet, process it and stop.
    const elapsedTime = Date.now() - prevSnippet.timestamp;
    if (elapsedTime >= MAX_SNIPPET_LENGTH) {
        startProcessingCurrentSnippet(meeting, userId);
        return;
    }

    // If there was a long period of silence, process it and stop.
    const snippetSilence = (Date.now() - prevSnippet.timestamp) - (prevSnippet.chunks.length * 1000 / SAMPLE_RATE / CHANNELS / BYTES_PER_SAMPLE);
    if (snippetSilence >= SILENCE_THRESHOLD) {
        startProcessingCurrentSnippet(meeting, userId);
        return;
    }

    // If we want to continue the same snippet, add a silence buffer to cover the gap.
    prevSnippet.chunks.push(generateSilentBuffer(snippetSilence, SAMPLE_RATE, CHANNELS));
}

export function startProcessingCurrentSnippet(meeting: MeetingData, newUserId?: string) {
    const currentSnippet = meeting.audioData.currentSnippet;
    meeting.audioData.currentSnippet = newUserId ? generateNewSnippet(newUserId) : null;

    if (!currentSnippet) {
        console.log("ODD BEHAVIOR - got told to process the current snippet, but it was null!");
        return;
    }

    const audioFileData: AudioFileData = {
        timestamp: currentSnippet.timestamp,
        userId: currentSnippet.userId,
        processing: true,
    };

    const promises: Promise<void>[] = [];

    if (getAudioDuration(currentSnippet) > MINIMUM_TRANSCRIPTION_LENGTH) {
        promises.push(transcribeSnippet(currentSnippet).then((transcription) => {
            audioFileData.transcript = transcription;
        }));
    }

    promises.push(
      new Promise<void>((resolve, reject) => {
          const buffer = Buffer.concat(currentSnippet.chunks);
          if (meeting.audioData.audioPassThrough) {
              meeting.audioData.audioPassThrough.write(buffer, (err) => {
                  if (err) {
                      reject(err);
                  } else {
                      resolve();
                  }
              });
          } else {
              reject(new Error('PassThrough stream is not available.'));
          }
      })
    );

    audioFileData.processingPromise = Promise.all(promises).then(() => {
        audioFileData.processing = false;
    });

    meeting.audioData.audioFiles.push(audioFileData);
}

export async function subscribeToUserVoice(meeting: MeetingData, userId: string) {
    const opusStream = meeting.connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual,
        },
    });

    // Decode the stream with high sample rate for both transcription and MP3 storage.
    // @ts-ignore
    const decodedStream = opusStream.pipe(new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: FRAME_SIZE }));

    // Create a pass-through stream to handle the high-fidelity audio data.
    const passThrough = new PassThrough();
    // @ts-ignore
    decodedStream.pipe(passThrough);

    // Handle the high-fidelity audio for processing and transcription.
    updateSnippetsIfNecessary(meeting, userId);

    passThrough.on('data', chunk => {
        meeting.audioData.currentSnippet!.chunks.push(chunk);
    });

    // Pipe the high-fidelity stream directly to the MP3 storage.
    passThrough.on('data', chunk => {
        if (meeting.audioData.audioPassThrough) {
            meeting.audioData.audioPassThrough.write(chunk);
        }
    });
}

export async function waitForFinishProcessing(meeting: MeetingData) {
    await Promise.all(meeting.audioData.audioFiles.map((fileData) => fileData.processingPromise));
}

function getAudioDuration(audio: AudioSnippet): number {
    return audio.chunks.reduce((acc, cur) => acc + cur.length, 0) / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
}

export function compileTranscriptions(client: Client, meeting: MeetingData): string {
    return meeting.audioData.audioFiles
      .filter((fileData) => fileData.transcript && fileData.transcript.length > 0)
      .map((fileData) => {
          const userTag = client.users.cache.get(fileData.userId)?.tag ?? fileData.userId;

          return `[${userTag} @ ${new Date(fileData.timestamp).toLocaleString()}]: ${fileData.transcript}`;
      }).join('\n');
}

export function openOutputFile(meeting: MeetingData) {
    const outputFileName = `./recording_${meeting.guildId}_${meeting.channelId}.mp3`;
    meeting.audioData.outputFileName = outputFileName;

    meeting.audioData.audioPassThrough = new PassThrough();

    meeting.audioData.ffmpegProcess = ffmpeg(meeting.audioData.audioPassThrough)
      .inputOptions([
          '-f s16le',                      // PCM format
          `-ar ${SAMPLE_RATE}`,        // Sample rate
          `-ac ${CHANNELS}`                 // Number of audio channels
      ])
      .audioCodec('libmp3lame')             // Use LAME codec for MP3
      .outputOptions([
          `-b:a 128k`,                      // Bitrate for lossy compression
          `-ac ${CHANNELS}`,                // Ensure stereo output
          `-ar ${SAMPLE_RATE}`         // Ensure output sample rate
      ])
      .toFormat('mp3')                      // Output format as MP3
      .on('error', (err) => {
          console.error('ffmpeg error:', err);
      })
      .save(outputFileName);
}

export function closeOutputFile(meeting: MeetingData): Promise<void> {
    return new Promise((resolve, reject) => {
        if (meeting.audioData.audioPassThrough) {
            meeting.audioData.audioPassThrough.end(); // End the PassThrough stream
        }
        if (meeting.audioData.ffmpegProcess) {
            meeting.audioData.ffmpegProcess.on('end', () => {
                console.log(`Final MP3 file created as ${meeting.audioData.outputFileName}`);
                resolve();
            });
        }
    });
}
