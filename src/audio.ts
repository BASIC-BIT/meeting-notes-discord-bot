import { unlinkSync, writeFileSync, createWriteStream, readFileSync } from "node:fs";
import {
    BYTES_PER_SAMPLE,
    CHANNELS, FRAME_SIZE, MAX_SNIPPET_LENGTH, MINIMUM_TRANSCRIPTION_LENGTH,
    SAMPLE_RATE_LOW,
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

export function combineAudioWithFFmpeg(audioFiles: AudioFileData[], outputFileName: string): Promise<void> {
    if(audioFiles.length === 0) {
        console.log('combineAudioWithFFmpeg received 0 files, returning...')
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        // Sort the audio files by timestamp to ensure they are in the correct order
        audioFiles.sort((a, b) => a.timestamp - b.timestamp);

        // Filter out files that are still processing or do not have a fileName
        const validFiles = audioFiles.filter(file => file.processing === false && file.fileName);

        if (validFiles.length === 0) {
            return reject(new Error('No valid audio files to combine.'));
        }

        const outputStream = createWriteStream(outputFileName);

        let previousEndTime = 0;

        const processNextFile = (index: number) => {
            if (index >= validFiles.length) {
                outputStream.end();
                console.log(`Final mixed audio file created as ${outputFileName}`);
                return resolve();
            }

            const file = validFiles[index];
            const currentStartTime = (file.timestamp - audioFiles[0].timestamp) / 1000; // Convert to seconds
            const delay = currentStartTime - previousEndTime;

            if (delay > 0) {
                // Add silence for the delay
                const silenceBuffer = generateSilentBuffer(delay * 1000, SAMPLE_RATE_LOW, CHANNELS);
                outputStream.write(silenceBuffer);
            }

            // Append the current file's PCM data to the output
            const pcmData = readFileSync(file.fileName!);
            outputStream.write(pcmData);

            previousEndTime = currentStartTime + (pcmData.length / (SAMPLE_RATE_LOW * CHANNELS * BYTES_PER_SAMPLE));

            // Remove the file after processing
            unlinkSync(file.fileName!);

            // Process the next file
            processNextFile(index + 1);
        };

        processNextFile(0);
    });
}

function generateNewSnippet(userId: string): AudioSnippet {
    return {
        chunks: [],
        timestamp: Date.now(),
        userId,
    }
}
// Create a new snippet if a new user is talking or if there was over 5 seconds of silence, otherwise returns the existing one to continue to capture data.  ALSO, generates silence since the last received packet
function updateSnippetsIfNecessary(meeting: MeetingData, userId: string): void {
    const prevSnippet = meeting.audioData.currentSnippet;

    //If this is our first snippet, generate a new one and stop
    if(!prevSnippet) {
        meeting.audioData.currentSnippet = generateNewSnippet(userId);
        return;
    }

    // If a new user is speaking, process current snippet and stop
    if(prevSnippet.userId !== userId) {
        startProcessingCurrentSnippet(meeting, userId);
        return;
    }

    // If it's been too long with the same snippet, process it and stop
    const elapsedTime = Date.now() - prevSnippet.timestamp;
    if(elapsedTime >= MAX_SNIPPET_LENGTH) {
        startProcessingCurrentSnippet(meeting, userId);
        return;
    }

    // If there was a long period of silence, process it and stop
    const snippetSilence = (Date.now() - prevSnippet.timestamp) - (prevSnippet.chunks.length * 1000 / SAMPLE_RATE_LOW / CHANNELS / BYTES_PER_SAMPLE);
    if(snippetSilence >= SILENCE_THRESHOLD) {
        startProcessingCurrentSnippet(meeting, userId);
        return;
    }

    // If we want to continue the same snippet, add a silence buffer to cover the gap
    // TODO: Should this even be here? Why keep useless silence?
    prevSnippet.chunks.push(generateSilentBuffer(snippetSilence, SAMPLE_RATE_LOW, CHANNELS));
}

export function startProcessingCurrentSnippet(meeting: MeetingData, newUserId?: string) {
    const currentSnippet = meeting.audioData.currentSnippet;
    meeting.audioData.currentSnippet = newUserId ? generateNewSnippet(newUserId) : null;

    if(!currentSnippet) {
        console.log("ODD BEHAVIOR - got told to process the current snippet, but was null!");
        return;
    }

    const audioFileData: AudioFileData = {
        timestamp: currentSnippet.timestamp,
        userId: currentSnippet.userId,
        processing: true,
    }

    // Calculate the duration of the snippet in seconds
    const snippetDuration = currentSnippet.chunks.length / (SAMPLE_RATE_LOW * CHANNELS * BYTES_PER_SAMPLE);
    console.log(currentSnippet.chunks.length);
    console.log(snippetDuration);

    const promises: Promise<void>[] = [];

    if (snippetDuration > MINIMUM_TRANSCRIPTION_LENGTH) {
        promises.push(transcribeSnippet(currentSnippet).then((transcription) => {
            audioFileData.transcript = transcription;
        }));
    }

    promises.push(
        convertSnippetToMp4(currentSnippet).then((fileName) => {
            audioFileData.fileName = fileName;
        }),
    )

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

    // @ts-ignore
    const decodedStream = opusStream.pipe(new prism.opus.Decoder({ rate: SAMPLE_RATE_LOW, channels: CHANNELS, frameSize: FRAME_SIZE }));
    const passThrough = new PassThrough();
    // @ts-ignore
    decodedStream.pipe(passThrough);

    updateSnippetsIfNecessary(meeting, userId);

    passThrough.on('data', chunk => {
        meeting.audioData.currentSnippet!.chunks.push(chunk);
    });
}

export async function convertSnippetToMp4(snippet: AudioSnippet): Promise<string> {
    const tempPcmFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}_audio.pcm`;
    const outputMp4FileName = `./snippet_${snippet.userId}_${snippet.timestamp}.mp3`;

    // Save the PCM buffer to a file
    const buffer = Buffer.concat(snippet.chunks);
    writeFileSync(tempPcmFileName, buffer);

    return new Promise<string>((resolve, reject) => {
        ffmpeg(tempPcmFileName)
            .inputOptions([
                `-f s16le`,                      // PCM format
                `-ar ${SAMPLE_RATE_LOW}`,         // Sample rate
                `-ac ${CHANNELS}`                 // Number of audio channels
            ])
            .outputOptions([
                `-b:a 128k`,                      // Bitrate for lossy compression
                `-ac ${CHANNELS}`,                // Ensure stereo output
                `-ar ${SAMPLE_RATE_LOW}`          // Ensure output sample rate
            ])
            .toFormat('mp3')                     // Output format
            .on('end', () => {
                // Cleanup the temporary PCM file
                unlinkSync(tempPcmFileName);
                resolve(outputMp4FileName);
            })
            .on('error', (err) => {
                console.error(`Error converting PCM to MP4: ${err.message}`);
                unlinkSync(tempPcmFileName);
                reject(err);
            })
            .save(outputMp4FileName);
    });
}

export async function waitForFinishProcessing(meeting: MeetingData) {
    await Promise.all(meeting.audioData.audioFiles.map((fileData) => fileData.processingPromise));
}

export function compileTranscriptions(client: Client, meeting: MeetingData): string {
    return meeting.audioData.audioFiles.map((fileData) => {
        const userTag = client.users.cache.get(fileData.userId)?.tag ?? fileData.userId;

        return `[${userTag} @ ${new Date(fileData.timestamp).toLocaleString()}]: ${fileData.transcript}`;
    }).join('\n');
}