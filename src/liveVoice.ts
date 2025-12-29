import OpenAI from "openai";
import { MeetingData } from "./types/meeting-data";
import { config } from "./services/configService";
import {
  buildLiveResponderContext,
  LatestUtterance,
} from "./services/liveResponderContextService";
import { formatParticipantLabel } from "./utils/participants";
import { getBotNameVariants } from "./utils/botNames";
import { resolveTtsVoice } from "./utils/ttsVoices";

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
  const botNames = getBotNameVariants(
    meeting.guild.members.me,
    meeting.guild.client.user,
  ).map((name) => name.toLowerCase());
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
    "You are Chronote, the meeting notes bot. Decide if you should speak aloud in the voice channel. " +
    "Only respond when the speaker is directly addressing you and a short verbal reply would be helpful (answering a question, clarifying, acknowledging action items). " +
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

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const systemPrompt =
    "You are Chronote, the meeting notes bot. You speak responses aloud via text-to-speech. " +
    "Respond in a concise, friendly way, usually 1 to 2 sentences, use 3 to 4 only if needed. " +
    "Do not include URLs, links, citations, IDs, or markdown. " +
    "Avoid long numbers. " +
    "Use the supplied context sections and stay on-topic to the latest line. " +
    "When referring to past meetings, prefer friendly relative phrasing while keeping dates accurate. " +
    `Today is ${todayLabel}.`;

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

export async function maybeRespondLive(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<void> {
  if (!meeting.liveVoiceEnabled || !segment.text.trim()) return;
  if (!isAddressed(segment.text, meeting)) return;

  // TODO: consider partial in-progress snippet context once latency allows.
  const decision = await shouldSpeak(meeting, segment);
  if (!decision.respond) return;

  const reply = await generateReply(meeting, segment);
  if (!reply) return;

  console.log(
    `[live-voice][speak] replying="${reply.slice(0, 120)}"${
      reply.length > 120 ? "..." : ""
    }`,
  );
  const botUserId =
    meeting.guild.members.me?.user.id || meeting.creator.client.user?.id;
  if (!botUserId) {
    console.warn("Could not determine bot user id for live voice reply.");
    return;
  }
  const voice = resolveTtsVoice(
    meeting.liveVoiceTtsVoice,
    config.liveVoice.ttsVoice,
  );
  const enqueued = meeting.ttsQueue?.enqueue({
    text: reply,
    voice,
    userId: botUserId,
    source: "live_voice",
    priority: "high",
  });
  if (!enqueued) {
    console.warn("Live voice reply dropped because TTS queue is full.");
  }
}
