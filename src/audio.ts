import {statSync, unlinkSync} from "node:fs";
import {BYTES_PER_SAMPLE, CHANNELS, FRAME_SIZE, SAMPLE_RATE_LOW, SILENCE_THRESHOLD} from "./constants";
import {exec} from "node:child_process";
import {AudioSnippet} from "./types/audio";
import {MeetingData} from "./types/meeting-data";
import {EndBehaviorType} from "@discordjs/voice";
import prism from "prism-media";
import {PassThrough} from "node:stream";

export function synchronizeUserAudio(userChunks: AudioSnippet[]) {
    const finalUserBuffer: Buffer[] = [];
    let lastTimestamp = userChunks[0].timestamp;
    let lastPacketCount = 0;

    for (let i = 0; i < userChunks.length; i++) {
        const currentData = userChunks[i];
        const timeDiff = currentData.timestamp - lastTimestamp;

        if (timeDiff > 0) {
            // Insert silence if there is a gap
            const silenceBuffer = generateSilentBuffer(timeDiff, SAMPLE_RATE_LOW, CHANNELS);
            finalUserBuffer.push(silenceBuffer);
        }

        finalUserBuffer.push(...currentData.chunks);
        lastTimestamp = currentData.timestamp;
        lastPacketCount = currentData.chunks.length;
    }

    return Buffer.concat(finalUserBuffer);
}

function generateSilentBuffer(durationMs: number, sampleRate: number, channels: number): Buffer {
    const numSamples = Math.floor((durationMs / 1000) * sampleRate) * channels;
    return Buffer.alloc(numSamples * BYTES_PER_SAMPLE);
}

export function combineAudioWithFFmpeg(userBuffers: string[], audioFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const validBuffers = userBuffers.filter(fileName => {
            try {
                const stats = statSync(fileName);
                return stats.size > 0;
            } catch (err) {
                console.error(`Error checking file ${fileName}:`, err);
                return false;
            }
        });

        if (validBuffers.length === 0) {
            return reject(new Error('No valid audio files to combine.'));
        }

        // Concatenate audio files with proper timing
        let ffmpegCommand = `ffmpeg -y `;

        validBuffers.forEach((fileName, index) => {
            ffmpegCommand += `-f s16le -ar ${SAMPLE_RATE_LOW} -ac ${CHANNELS} -i ${fileName} `;
        });

        // Use concat filter to join all audio files together
        const concatFilter = validBuffers.map((_, index) => `[${index}:a]`).join('') + `concat=n=${validBuffers.length}:v=0:a=1[out]`;

        ffmpegCommand += `-filter_complex "${concatFilter}" -map "[out]" -f wav -c:a pcm_s16le ${audioFilePath}`;

        exec(ffmpegCommand, (err, stdout, stderr) => {
            if (err) {
                console.error('Error combining audio with ffmpeg:', err);
                reject(err);
                return;
            }

            console.log(`Final mixed audio file created as ${audioFilePath}`);
            validBuffers.forEach(fileName => unlinkSync(fileName)); // Cleanup temp files
            resolve();
        });
    });
}

export function mergeSnippetsAcrossUsers(audioData: Map<string, AudioSnippet[]>): { snippet: AudioSnippet, userId: string }[] {
    const allSnippets: { snippet: AudioSnippet, userId: string }[] = [];

    audioData.forEach((snippets, userId) => {
        snippets.forEach(snippet => {
            allSnippets.push({ snippet, userId });
        });
    });

    allSnippets.sort((a, b) => a.snippet.timestamp - b.snippet.timestamp);

    const mergedSnippets: { snippet: AudioSnippet, userId: string }[] = [];
    let currentSnippet: { snippet: AudioSnippet, userId: string } | null = null;
    let lastSnippetEndTime = 0;

    allSnippets.forEach(({ snippet, userId }) => {
        const snippetDuration = snippet.chunks.length * (1000 / SAMPLE_RATE_LOW) / CHANNELS;
        const snippetEndTime = snippet.timestamp + snippetDuration;

        if (!currentSnippet) {
            currentSnippet = { snippet: { chunks: [...snippet.chunks], timestamp: snippet.timestamp }, userId };
            lastSnippetEndTime = snippetEndTime;
        } else {
            if (snippet.timestamp <= lastSnippetEndTime + SILENCE_THRESHOLD) {
                currentSnippet.snippet.chunks.push(...snippet.chunks);
                lastSnippetEndTime = snippetEndTime;
            } else {
                const silenceDuration = snippet.timestamp - lastSnippetEndTime;
                if (silenceDuration > 0) {
                    const silenceBuffer = generateSilentBuffer(silenceDuration, SAMPLE_RATE_LOW, CHANNELS);
                    currentSnippet.snippet.chunks.push(silenceBuffer);
                }
                mergedSnippets.push(currentSnippet);
                currentSnippet = { snippet: { chunks: [...snippet.chunks], timestamp: snippet.timestamp }, userId };
                lastSnippetEndTime = snippetEndTime;
            }
        }
    });

    if (currentSnippet) {
        mergedSnippets.push(currentSnippet);
    }

    return mergedSnippets;
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

    if (!meeting.audioData.has(userId)) {
        meeting.audioData.set(userId, []);
    }

    const snippet: AudioSnippet = {
        chunks: [],
        timestamp: Date.now(),
    };
    meeting.audioData.get(userId)!.push(snippet);

    passThrough.on('data', chunk => {
        snippet.chunks.push(chunk);
    });
}