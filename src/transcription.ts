import OpenAI from "openai";
import {createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync} from "node:fs";
import {
    CHANNELS,
    OPENAI_API_KEY, OPENAI_ORGANIZATION_ID, OPENAI_PROJECT_ID,
    SAMPLE_RATE, TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
    TRANSCRIPTION_BREAK_DURATION, TRANSCRIPTION_MAX_CONCURRENT, TRANSCRIPTION_MAX_QUEUE,
    TRANSCRIPTION_MAX_RETRIES, TRANSCRIPTION_RATE_MIN_TIME, TRANSCRIPTION_SPEECH_PROBABILITY_CUTOFF
} from "./constants";
import ffmpeg from "fluent-ffmpeg";
import {AudioSnippet} from "./types/audio";
import {bulkhead, circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleAll, retry, wrap} from "cockatiel";
import {MeetingData} from "./types/meeting-data";
import Bottleneck from "bottleneck";
import {TranscriptionResponse} from "./types/transcription";

const openAIClient = new OpenAI({
    apiKey: OPENAI_API_KEY,
    organization: OPENAI_ORGANIZATION_ID,
    project: OPENAI_PROJECT_ID,
});

async function transcribeInternal(meeting: MeetingData, file: string): Promise<string> {
    const transcription = await openAIClient.audio.transcriptions.create({
        file: createReadStream(file),
        model: "whisper-1",
        language: "en",
        prompt: getTranscriptionKeywords(meeting),
        temperature: 0,
        response_format: "verbose_json"
    }) as TranscriptionResponse;

    console.log(transcription);

    return cleanupTranscriptionResponse(transcription);
}

function cleanupTranscriptionResponse(response: TranscriptionResponse): string {
    return response.segments
        .filter((segment) =>
            segment.no_speech_prob < TRANSCRIPTION_SPEECH_PROBABILITY_CUTOFF)
        .map((segment) => segment.text)
        .join('')
        .trim();
}


const retryPolicy = retry(handleAll, {maxAttempts: TRANSCRIPTION_MAX_RETRIES, backoff: new ExponentialBackoff()});
const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: TRANSCRIPTION_BREAK_DURATION,
    breaker: new ConsecutiveBreaker(TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES),
});
const bulkheadPolicy = bulkhead(TRANSCRIPTION_MAX_CONCURRENT, TRANSCRIPTION_MAX_QUEUE);

const policies = wrap(bulkheadPolicy, breakerPolicy, retryPolicy);

const limiter = new Bottleneck({
    minTime: TRANSCRIPTION_RATE_MIN_TIME,
});

async function transcribe(meeting: MeetingData, file: string): Promise<string> {
    return await policies.execute((() =>
        limiter.schedule(() =>
            transcribeInternal(meeting, file))));
}

export async function transcribeSnippet(meeting: MeetingData, snippet: AudioSnippet): Promise<string> {
    const tempPcmFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}_transcript.pcm`;
    const tempWavFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}.wav`;

    // Ensure the directories exist
    const tempDir = './';
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, {recursive: true});
    }

    // Write the PCM buffer to a file
    const buffer = Buffer.concat(snippet.chunks);
    writeFileSync(tempPcmFileName, buffer);

    // Convert PCM to WAV using ffmpeg
    await new Promise<void>((resolve, reject) => {
        ffmpeg(tempPcmFileName)
            .inputOptions([
                `-f s16le`,
                `-ar ${SAMPLE_RATE}`,
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
        const transcription = await transcribe(meeting, tempWavFileName);

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


export async function cleanupTranscription(meeting: MeetingData, transcription: string) {
    const systemPrompt = await getTranscriptionCleanupSystemPrompt(meeting);
    const response = await openAIClient.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "system",
                content: systemPrompt,
            },
            {
                role: "user",
                content: transcription,
            }
        ],
        temperature: 0,
        user: meeting.creator.id,
    });

    return response.choices[0].message.content;
}

// Get keywords from the server that are likely to help the translation, such as server name, channel names, role names, and attendee names
export function getTranscriptionKeywords(meeting: MeetingData): string {
    const serverName = meeting.voiceChannel.guild.name;
    const attendees = Array.from(meeting.attendance).map((attendee) => `"${attendee}"`).join(', ');
    return `The transcript is a meeting held in a Discord server with the name "${serverName}", and attendees: ${attendees}.`;
}

export async function getTranscriptionCleanupSystemPrompt(meeting: MeetingData): Promise<string> {

    const serverName = meeting.guild.name;
    const serverDescription = meeting.guild.description;
    const roles = meeting.guild.roles.valueOf().map((role) => role.name).join(', ');
    const events = meeting.guild.scheduledEvents.valueOf().map((event) => event.name).join(', ');
    const channelNames = meeting.guild.channels.valueOf().map((channel) => channel.name).join(', ');
    const prompt = "You are a helpful Discord bot that records meetings and provides transcriptions. " +
        "Your task is to correct any spelling discrepancies in the transcribed text, and to correct anything that could've been mis-transcribed. " +
        "Remove any lines that are likely mis-transcriptions due to the Whisper model being sent non-vocal audio like breathing or typing, but only if the certainty is high. " +
        "Only make changes if you are confident it would not alter the meaning of the transcription. " +
        "Output only the altered transcription, in the same format it was received in. " +
        "The meeting attendees are: " +
        Array.from(meeting.attendance).join(', ') + ".\n" +
        `This meeting is happening in a discord named: "${serverName}", with a description of \"${serverDescription}\", in a voice channel named ${meeting.voiceChannel.name}.\n` +
        `The roles available to users in this server are: ${roles}.\n` +
        `The upcoming events happening in this server are: ${events}.\n` +
        `The channels in this server are: ${channelNames}.`;

    return prompt;
}