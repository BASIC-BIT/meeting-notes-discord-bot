import {
  AudioPlayerStatus,
  StreamType,
  createAudioResource,
} from "@discordjs/voice";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import prism from "prism-media";
import { Readable } from "node:stream";
import { ReadableStream as WebReadableStream } from "node:stream/web";
import { MeetingData } from "./types/meeting-data";
import { config } from "./services/configService";
import { AudioFileData } from "./types/audio";
import { buildThinkingCueResource } from "./audio/thinkingCue";
import { answerQuestionService } from "./services/askService";
import {
  buildLiveResponderContext,
  LatestUtterance,
} from "./services/liveResponderContextService";
import { formatParticipantLabel } from "./utils/participants";

type GateDecision = {
  respond: boolean;
};

export type LiveSegment = {
  userId: string;
  text: string;
  timestamp: number;
};

const openAIClient = new OpenAI({
  apiKey: config.openai.apiKey,
  organization: config.openai.organizationId,
  project: config.openai.projectId,
});

const RECENT_LINES = 3;
const OUTPUT_SAMPLE_RATE = 48000;

function getSpeakerLabel(meeting: MeetingData, userId: string): string {
  const participant = meeting.participants.get(userId);
  return formatParticipantLabel(participant, {
    includeUsername: false,
    fallbackName: userId,
  });
}

function collectRecentTranscripts(meeting: MeetingData): string[] {
  const lines = meeting.audioData.audioFiles
    .filter((f) => f.transcript && f.transcript.length > 0)
    .slice(-RECENT_LINES)
    .map((f) => {
      const speaker = getSpeakerLabel(meeting, f.userId);
      return `${speaker}: ${f.transcript}`;
    });
  return lines;
}

function isAddressed(text: string, meeting: MeetingData): boolean {
  const lower = text.toLowerCase();
  const botNames = [
    meeting.guild.members.me?.displayName?.toLowerCase(),
    meeting.guild.members.me?.user.username.toLowerCase(),
    "meetingnotesbot",
    "meeting notes bot",
  ].filter(Boolean) as string[];
  return botNames.some((n) => n && lower.includes(n));
}

async function shouldSpeak(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<GateDecision> {
  if (!meeting.liveVoiceEnabled) {
    return { respond: false };
  }
  const recent = collectRecentTranscripts(meeting);
  const speaker = getSpeakerLabel(meeting, segment.userId);

  console.log(
    `[live-voice][gate] candidate text="${segment.text.slice(0, 120)}"${
      segment.text.length > 120 ? "..." : ""
    } speaker=${speaker}`,
  );
  const systemPrompt =
    "You are Meeting Notes Bot. Decide if you should speak aloud in the voice channel. " +
    "Only respond when a short verbal reply would be helpful (answering a question, clarifying, acknowledging action items). " +
    'Return EXACTLY one JSON object, no prose. Schema: {"respond": boolean}. ' +
    "If you should NOT speak, set respond:false. If you should speak, set respond:true. " +
    "Never return empty content. Never omit fields. Never add extra keys.";

  const userPrompt = [
    `Latest line (${new Date(segment.timestamp).toISOString()}): ${speaker}: ${segment.text}`,
    recent.length > 0
      ? `Recent context:\n${recent.join("\n")}`
      : "No prior transcript context.",
    `Server: ${meeting.guild.name}`,
    `Channel: ${meeting.voiceChannel.name}`,
  ].join("\n");

  try {
    const completion = await openAIClient.chat.completions.create({
      model: config.liveVoice.gateModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: config.liveVoice.gateMaxOutputTokens,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content ?? "";
    const finish = completion.choices[0].finish_reason;
    console.log(
      `[live-voice][gate] model=${config.liveVoice.gateModel} finish=${finish} raw=${content}`,
    );

    if (!content.trim()) {
      console.warn("[live-voice][gate] empty content from gate model");
      return { respond: false };
    }

    const parsed = JSON.parse(content) as GateDecision;
    if (parsed.respond === undefined) {
      return { respond: false };
    }
    return { respond: !!parsed.respond };
  } catch (error) {
    console.error("Live voice gate failed:", error);
    return { respond: false };
  }
}

async function generateReply(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<string | undefined> {
  const speaker = getSpeakerLabel(meeting, segment.userId);
  const latest: LatestUtterance = {
    speaker,
    text: segment.text,
    timestamp: segment.timestamp,
  };

  const { userPrompt, debug } = await buildLiveResponderContext(
    meeting,
    latest,
  );

  const systemPrompt =
    "You are Meeting Notes Bot. Respond out loud to the speaker in a concise, friendly way (1–3 sentences). " +
    "Use the supplied context sections; stay on-topic to the latest line. Do not add markdown or code fences.";

  try {
    const completion = await openAIClient.chat.completions.create({
      model: config.liveVoice.responderModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 200,
    });

    const content = completion.choices[0].message.content ?? "";
    console.log(
      `[live-voice][responder] model=${config.liveVoice.responderModel} ` +
        `windowLines=${debug.windowLines} pastMeetings=${
          debug.pastMeetings.map((m) => m.meetingId).join(",") || "none"
        }`,
    );
    if (!content.trim()) return undefined;
    return content.trim();
  } catch (error) {
    console.error("Live voice responder failed:", error);
    return undefined;
  }
}

async function streamTtsToDiscord(
  meeting: MeetingData,
  reply: string,
): Promise<void> {
  if (!meeting.liveAudioPlayer) return;

  try {
    const speechResponse = await openAIClient.audio.speech.create({
      model: config.liveVoice.ttsModel,
      voice: config.liveVoice.ttsVoice,
      input: reply,
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

    // Tee the PCM to the meeting recording so bot audio is captured in the MP3
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
    meeting.liveAudioPlayer.play(resource);
    meeting.liveAudioPlayer.once(AudioPlayerStatus.Idle, () => {
      const durationMs = Date.now() - start;
      console.log(
        `Live voice playback finished (${durationMs}ms): ${reply.slice(0, 80)}`,
      );

      // Append bot reply to transcript after successful playback
      const botUserId =
        meeting.guild.members.me?.user.id || meeting.creator.client.user?.id;
      if (botUserId) {
        const botEntry: AudioFileData = {
          userId: botUserId,
          timestamp: start,
          transcript: reply,
          processing: false,
          audioOnlyProcessing: false,
        };
        meeting.audioData.audioFiles.push(botEntry);
      } else {
        console.warn("Could not determine bot user id for transcript entry.");
      }
    });
  } catch (error) {
    console.error("Failed to stream TTS to Discord:", error);
  }
}

export async function maybeRespondLive(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<void> {
  if (!meeting.liveVoiceEnabled || !segment.text.trim()) return;

  const decision = await shouldSpeak(meeting, segment);
  if (!decision.respond) return;

  // Optional thinking cue while generating the full reply (looped)
  let stopCue = false;
  let cueLoop: Promise<void> | undefined;
  if (config.liveVoice.thinkingCue && meeting.liveAudioPlayer) {
    const playOnce = () =>
      new Promise<void>((resolve) => {
        const cue = buildThinkingCueResource();
        meeting.liveAudioPlayer!.play(cue);
        meeting.liveAudioPlayer!.once(AudioPlayerStatus.Idle, () => resolve());
      });
    cueLoop = (async () => {
      while (!stopCue) {
        await playOnce();
        if (stopCue) break;
        await new Promise((r) =>
          setTimeout(r, config.liveVoice.thinkingCueIntervalMs),
        );
      }
    })();
  }

  const reply = isAddressed(segment.text, meeting)
    ? (
        await answerQuestionService({
          guildId: meeting.guildId,
          channelId: meeting.channelId,
          question: segment.text,
          scope: "guild",
        })
      ).answer
    : await generateReply(meeting, segment);
  stopCue = true;
  if (cueLoop) {
    await cueLoop;
  }
  if (!reply) return;

  console.log(
    `[live-voice][speak] replying="${reply.slice(0, 120)}"${
      reply.length > 120 ? "..." : ""
    }`,
  );
  await streamTtsToDiscord(meeting, reply);
}
