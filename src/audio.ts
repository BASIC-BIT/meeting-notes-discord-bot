import {
    BYTES_PER_SAMPLE,
    CHANNELS, FRAME_SIZE, MAX_DISCORD_UPLOAD_SIZE, MAX_SNIPPET_LENGTH, MINIMUM_TRANSCRIPTION_LENGTH,
    SAMPLE_RATE,
    SILENCE_THRESHOLD
} from "./constants";
import { AudioFileData, AudioSnippet } from "./types/audio";
import { MeetingData } from "./types/meeting-data";
import { EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { PassThrough } from "node:stream";
import { cleanupTranscription, transcribeSnippet } from "./transcription";
import ffmpeg from "fluent-ffmpeg";
import { Client } from "discord.js";
import * as fs from "node:fs";
import path from "node:path";

function generateNewSnippet(userId: string): AudioSnippet {
    return {
        chunks: [],
        timestamp: Date.now(),
        userId,
    };
}

// Handle snippets based on the user speaking
function updateSnippetsIfNecessary(meeting: MeetingData, userId: string): void {
    const currentSnippets = meeting.audioData.currentSnippets || new Map<string, AudioSnippet>();

    let snippet = currentSnippets.get(userId);

    if (!snippet) {
        snippet = generateNewSnippet(userId);
        currentSnippets.set(userId, snippet);
    } else {
        const elapsedTime = Date.now() - snippet.timestamp;
        if (elapsedTime >= MAX_SNIPPET_LENGTH) {
            startProcessingSnippet(meeting, userId);
            snippet = generateNewSnippet(userId);
            currentSnippets.set(userId, snippet);
        }
    }

    meeting.audioData.currentSnippets = currentSnippets;
}

// Start processing a specific user's snippet
export function startProcessingSnippet(meeting: MeetingData, userId: string) {
    const snippet = meeting.audioData.currentSnippets?.get(userId);
    if (!snippet) return;

    const audioFileData: AudioFileData = {
        timestamp: snippet.timestamp,
        userId: snippet.userId,
        processing: true,
    };

    const promises: Promise<void>[] = [];

    if (getAudioDuration(snippet) > MINIMUM_TRANSCRIPTION_LENGTH) {
        promises.push(transcribeSnippet(meeting, snippet).then((transcription) => {
            audioFileData.transcript = transcription;
        }));
    }

    promises.push(
        new Promise<void>((resolve, reject) => {
            const buffer = Buffer.concat(snippet!.chunks);
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
    meeting.audioData.currentSnippets?.delete(userId); // Remove snippet after processing
}

// Set a timer to process the snippet after SILENCE_THRESHOLD
function setSnippetTimer(meeting: MeetingData, userId: string) {
    const currentTimers = meeting.audioData.silenceTimers || new Map<string, NodeJS.Timeout>();

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

// Subscribe to a user's voice stream and handle the audio data
export async function subscribeToUserVoice(meeting: MeetingData, userId: string) {
    const opusStream = meeting.connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual,
        },
    });

    // Decode the stream with high sample rate for both transcription and MP3 storage.
    // @ts-ignore
    const decodedStream = opusStream.pipe(new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: FRAME_SIZE }));

    // Handle the high-fidelity audio for processing and transcription.
    updateSnippetsIfNecessary(meeting, userId);

    decodedStream.on('data', chunk => {
        const snippet = meeting.audioData.currentSnippets?.get(userId);
        if (snippet) {
            snippet.chunks.push(chunk);
        }
    });
}

// Subscribe to a user's voice stream and handle the audio data
export async function userStopTalking(meeting: MeetingData, userId: string) {
    setSnippetTimer(meeting, userId);
}

export async function waitForFinishProcessing(meeting: MeetingData) {
    await Promise.all(meeting.audioData.audioFiles.map((fileData) => fileData.processingPromise));
}

function getAudioDuration(audio: AudioSnippet): number {
    return audio.chunks.reduce((acc, cur) => acc + cur.length, 0) / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
}

export async function compileTranscriptions(client: Client, meeting: MeetingData): Promise<string> {
    const transcription = meeting.audioData.audioFiles
        .filter((fileData) => fileData.transcript && fileData.transcript.length > 0)
        .map((fileData) => {
            const userTag = client.users.cache.get(fileData.userId)?.tag ?? fileData.userId;

            return `[${userTag} @ ${new Date(fileData.timestamp).toLocaleString()}]: ${fileData.transcript}`;
        }).join('\n');

    if (transcription.length === 0) {
        return transcription;
    }

    console.log(transcription);

    const cleanedUpTranscription = await cleanupTranscription(meeting, transcription);

    return `NOTICE: Transcription is automatically generated and may not be perfectly accurate!
    -----------------------------------------------------------------------------------
    ${cleanedUpTranscription}`;
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

interface ChunkInfo {
    start: number;
    end: number;
    file: string;
}

/**
 * Split audio into chunks that are under 25MB
 * @param {string} inputFile - The path to the input MP3 file
 * @param {string} outputDir - The directory to store the output chunks
 * @returns {Promise<ChunkInfo[]>} - An array of chunk info (start, end, file)
 */
export async function splitAudioIntoChunks(inputFile: string, outputDir: string): Promise<ChunkInfo[]> {
    try {
        // Ensure the output directory exists
        await fs.promises.mkdir(outputDir, { recursive: true });

        const stats = await fs.promises.stat(inputFile);
        const totalFileSize = stats.size;

        const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(inputFile, (err, data) => {
                if (err) return reject(err);
                resolve(data);
            });
        });

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
                        .on('end', () => {
                            console.log(`Chunk ${i} saved: ${chunkFileName}`);
                            resolve({ start: startTime, end: endTime, file: chunkFileName });
                        })
                        .on('error', (err: Error) => {
                            console.error(`Error splitting chunk ${i}: ${err.message}`);
                            reject(err);
                        })
                        .run();
                })
            );

            startTime += maxChunkDuration;
        }

        return Promise.all(chunkPromises);
    } catch (err) {
        console.error(`Error splitting audio: ${err}`);
        throw err;
    }
}

/**
 * Get all files from a folder into a string array
 * @param {string} folderPath - The path to the folder
 * @returns {Promise<string[]>} - An array of file paths
 */
export async function getFilesInFolder(folderPath: string): Promise<string[]> {
    try {
        const files = await fs.promises.readdir(folderPath);
        const filePaths = files.map(file => path.join(folderPath, file));
        return filePaths;
    } catch (err) {
        console.error(`Error reading folder: ${err}`);
        throw err;
    }
}