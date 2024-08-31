import dotenv from "dotenv";

export const SAMPLE_RATE = 48000; // 48kHz for audio recording and transcriptio
export const CHANNELS = 2; // Stereo data
export const BYTES_PER_SAMPLE = 2; // 16 bit audio in this format
export const FRAME_SIZE = 960; // something about the UDP connection?
export const SILENCE_THRESHOLD = 5000; // ms of silence before determining that a new snippet must be created

export const MAX_SNIPPET_LENGTH = 60000; // maximum amount of time to put into a single snippet, to prevent our lossless audio buffer from getting too large

export const MINIMUM_TRANSCRIPTION_LENGTH = 0.11;

export const MAXIMUM_MEETING_DURATION = 7200000; // Max meeting duration of 2 hours
export const MAXIMUM_MEETING_DURATION_PRETTY = "2 hours"; // Max meeting duration of 2 hours

dotenv.config();

export const TOKEN = process.env.DISCORD_BOT_TOKEN!;
export const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

