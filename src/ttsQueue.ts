import {
  AudioPlayer,
  AudioPlayerStatus,
  StreamType,
  createAudioResource,
} from "@discordjs/voice";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import prism from "prism-media";
import { Readable } from "node:stream";
import { ReadableStream as WebReadableStream } from "node:stream/web";
import type { MeetingData } from "./types/meeting-data";
import { config } from "./services/configService";
import type { AudioFileData } from "./types/audio";
import { chatTtsSpoken } from "./metrics";

export type TtsQueueSource = "live_voice" | "chat_tts";

export type TtsQueueItem = {
  text: string;
  voice: string;
  userId: string;
  source: TtsQueueSource;
  messageId?: string;
  priority?: "high" | "normal";
};

export type TtsQueue = {
  enqueue: (item: TtsQueueItem) => boolean;
  stopAndClear: () => void;
  size: () => number;
};

const openAIClient = new OpenAI({
  apiKey: config.openai.apiKey,
  organization: config.openai.organizationId,
  project: config.openai.projectId,
});

const OUTPUT_SAMPLE_RATE = 48000;

function waitForIdle(player: AudioPlayer) {
  return new Promise<void>((resolve, reject) => {
    const onIdle = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off("error", onError);
    };
    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once("error", onError);
  });
}

async function playTtsItem(
  meeting: MeetingData,
  player: AudioPlayer,
  item: TtsQueueItem,
): Promise<void> {
  const speechResponse = await openAIClient.audio.speech.create({
    model: config.liveVoice.ttsModel,
    voice: item.voice,
    input: item.text,
    response_format: "pcm",
  });

  if (!speechResponse.body) {
    console.warn("No audio body returned from TTS.");
    return;
  }

  const pcm24Stream = Readable.fromWeb(
    speechResponse.body as unknown as WebReadableStream<Uint8Array>,
  );

  const resampledPcm = ffmpeg(pcm24Stream)
    .inputOptions(["-f s16le", "-ar 24000", "-ac 1"])
    .audioFrequency(OUTPUT_SAMPLE_RATE)
    .audioChannels(2)
    .format("s16le")
    .on("error", (err) => console.error("ffmpeg TTS pipeline error:", err))
    .pipe();

  // Tee the PCM to the meeting recording so bot audio is captured in the MP3.
  resampledPcm.on("data", (chunk: Buffer) => {
    if (meeting.audioData.audioPassThrough) {
      meeting.audioData.audioPassThrough.write(chunk, (err) => {
        if (err) {
          console.error("Error writing TTS chunk to recording:", err);
        }
      });
    }
  });

  const opusEncoder = new prism.opus.Encoder({
    rate: OUTPUT_SAMPLE_RATE,
    channels: 2,
    frameSize: 960,
  });

  const opusStream = resampledPcm.pipe(opusEncoder);
  const resource = createAudioResource(opusStream, {
    inputType: StreamType.Opus,
  });

  const start = Date.now();
  player.play(resource);
  await waitForIdle(player);

  const entry: AudioFileData = {
    userId: item.userId,
    timestamp: start,
    transcript: item.text,
    processing: false,
    audioOnlyProcessing: false,
    source: item.source === "chat_tts" ? "chat_tts" : "bot",
    messageId: item.messageId,
  };
  meeting.audioData.audioFiles.push(entry);

  if (item.source === "chat_tts") {
    chatTtsSpoken.inc();
  }
}

export function createTtsQueue(
  meeting: MeetingData,
  player: AudioPlayer,
): TtsQueue {
  const queue: TtsQueueItem[] = [];
  let playing = false;

  const playNext = async () => {
    if (playing || queue.length === 0) return;
    playing = true;
    const item = queue.shift();
    if (!item) {
      playing = false;
      return;
    }
    try {
      await playTtsItem(meeting, player, item);
    } catch (error) {
      console.error("Failed to stream TTS to Discord:", error);
    } finally {
      playing = false;
      if (queue.length > 0) {
        void playNext();
      }
    }
  };

  const enqueue = (item: TtsQueueItem) => {
    if (queue.length >= config.chatTts.queueLimit) {
      if (item.priority === "high") {
        queue.length = 0;
      } else {
        return false;
      }
    }
    queue.push(item);
    void playNext();
    return true;
  };

  const stopAndClear = () => {
    queue.length = 0;
    player.stop(true);
  };

  return {
    enqueue,
    stopAndClear,
    size: () => queue.length,
  };
}
