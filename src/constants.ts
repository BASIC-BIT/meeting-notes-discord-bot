import dotenv from "dotenv";

export const SAMPLE_RATE = 16000; // 48kHz for audio recording and transcription
export const CHANNELS = 2; // Stereo data
export const BYTES_PER_SAMPLE = 2; // 16 bit audio in this format
export const FRAME_SIZE = 320; // something about the UDP connection?
export const SILENCE_THRESHOLD = 5000; // ms of silence before determining that a new snippet must be created

export const MAX_SNIPPET_LENGTH = 60000; // maximum amount of time to put into a single snippet, to prevent our lossless audio buffer from getting too large

export const MINIMUM_TRANSCRIPTION_LENGTH = 0.3;

export const MAXIMUM_MEETING_DURATION = 7_200_000; // Max meeting duration of 2 hours
export const MAXIMUM_MEETING_DURATION_PRETTY = "2 hours"; // Max meeting duration of 2 hours

export const TRANSCRIPTION_MAX_RETRIES = 3;
export const TRANSCRIPTION_MAX_CONCURRENT = 1;
export const TRANSCRIPTION_MAX_QUEUE = 100;
export const TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES = 5;
export const TRANSCRIPTION_BREAK_DURATION = 10_000;
export const TRANSCRIPTION_RATE_MIN_TIME = 1_300; // Rate limit in minimum milliseconds between requests

export const TRANSCRIPTION_NO_SPEECH_PROBABILITY_CUTOFF = 0.7;
export const TRANSCRIPTION_LOGPROB_CUTOFF = -0.65;
export const TRANSCRIPTION_LOGPROB_HARD_CUTOFF = -0.9;
export const TRANSCRIPTION_COMPRESSION_RATIO_CUTOFF = 4;

export const MAX_DISCORD_UPLOAD_SIZE = 24_000_000; //24MB, to give safety margin from Discord's 25MB upload limit

dotenv.config();

export const TOKEN = process.env.DISCORD_BOT_TOKEN!;
export const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
export const OPENAI_ORGANIZATION_ID = process.env.OPENAI_ORGANIZATION_ID;
export const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID;

export const GPT_MODEL_MAX_TOKENS = 128000;

export const TRANSCRIPTION_CLEANUP_LINES_DIFFERENCE_ISSUE = 0.75; // If over 25% of lines were lost in cleanup, assume something went wrong and return original transcription
