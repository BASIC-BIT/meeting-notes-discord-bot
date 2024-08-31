import OpenAI from "openai";
import {createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync} from "node:fs";
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

export async function transcribeSnippet(snippet: AudioSnippet): Promise<string> {
    const tempPcmFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}_transcript.pcm`;
    const tempWavFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}.wav`;

    // Ensure the directories exist
    const tempDir = './';
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
    }

    // Write the PCM buffer to a file
    const buffer = Buffer.concat(snippet.chunks);
    writeFileSync(tempPcmFileName, buffer);

    // Convert PCM to WAV using ffmpeg
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
            .on('end', () => {
                console.log("Finished converting PCM to WAV");
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error converting PCM to WAV: ${err.message}`);
                reject(err);
            })
            .save(tempWavFileName); // Ensure this is within the promise chain
    });

    try {
        // Transcribe the WAV file
        const transcription = await transcribe(tempWavFileName);

        // Cleanup temporary files
        if (existsSync(tempPcmFileName)) {
            unlinkSync(tempPcmFileName);
        } else {
            console.log('failed cleaning up temp pcm file, continuing')
        }
        if (existsSync(tempWavFileName)) {
            unlinkSync(tempWavFileName);
        } else {
            console.log('failed cleaning up temp wav file, continuing')
        }

        return transcription;
    } catch (e) {
        console.error(`Failed to transcribe snippet for user ${snippet.userId}:`, e);

        // Cleanup temporary files on error
        if (existsSync(tempPcmFileName)) {
            unlinkSync(tempPcmFileName);
        } else {
            console.log('failed cleaning up temp pcm file, continuing')
        }
        if (existsSync(tempWavFileName)) {
            unlinkSync(tempWavFileName);
        } else {
            console.log('failed cleaning up temp wav file, continuing')
        }

        return `[Transcription failed]`;
    }
}
