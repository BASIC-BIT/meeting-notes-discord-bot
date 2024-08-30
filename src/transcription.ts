import OpenAI from "openai";
import {createReadStream, unlinkSync, writeFileSync} from "node:fs";
import {CHANNELS, OPENAI_API_KEY, SAMPLE_RATE_LOW} from "./constants";
import ffmpeg from "fluent-ffmpeg";
import {AudioSnippet} from "./types/audio";

const openAIClient = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

async function transcribe(file: string): Promise<string> {
    const transcription = await openAIClient.audio.transcriptions.create({
        file: createReadStream(file),
        model: "whisper-1",
        language: "en",
    });

    return transcription.text;
}

export async function transcribeSnippet(snippet: AudioSnippet, userId: string, userTag: string): Promise<string> {
    const tempPcmFileName = `./temp_snippet_${userId}_${snippet.timestamp}.pcm`;
    const tempWavFileName = `./temp_snippet_${userId}_${snippet.timestamp}.wav`;

    const buffer = Buffer.concat(snippet.chunks);
    console.log(snippet.chunks.length);
    writeFileSync(tempPcmFileName, buffer);

    await new Promise<void>((resolve, reject) => {
        ffmpeg(tempPcmFileName)
            .inputOptions([
                `-f s16le`,
                `-ar ${SAMPLE_RATE_LOW}`,
                `-ac ${CHANNELS}`
            ])
            .outputOptions([
                `-f wav`,
                `-c:a pcm_s16le`
            ])
            .save(tempWavFileName)
            .on('end', () => {
                console.log("Finished converting PCM to WAV")
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error converting PCM to WAV: ${err.message}`);
                reject(err);
            });
    });

    try {
        const transcription = transcribe(tempWavFileName);

        // Cleanup temporary files
        unlinkSync(tempPcmFileName);
        unlinkSync(tempWavFileName);

        return `[${userTag} @ ${new Date(snippet.timestamp).toLocaleString()}]: ${transcription}`;
    } catch (e) {
        console.error(`Failed to transcribe snippet for user ${userId}:`, e);
        unlinkSync(tempPcmFileName);
        unlinkSync(tempWavFileName);
        return `[${userTag} @ ${new Date(snippet.timestamp).toLocaleString()}]: [Transcription failed]`;
    }
}