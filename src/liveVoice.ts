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
import {
  enqueueDenialCue,
  startThinkingCueLoop,
  stopThinkingCueLoop,
} from "./audio/soundCues";
import { canUserEndMeeting } from "./utils/meetingPermissions";

type GateAction = "respond" | "command_end" | "none";

type GateDecision = {
  action: GateAction;
};

type ConfirmationDecision = {
  decision: "confirm" | "deny" | "unclear";
};

type LiveVoiceFlags = {
  liveVoiceEnabled: boolean;
  liveVoiceCommandsEnabled: boolean;
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
const COMMAND_CONFIRM_TIMEOUT_MS = 30_000;
const COMMAND_CONFIRM_PROMPT = "Chronote: Confirm end meeting?";
const COMMAND_DENY_PROMPT = "Chronote: Okay, confirmed your denial.";

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
  return botNames.some((name) => name && lower.includes(name));
}

async function shouldAct(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<GateDecision> {
  const recent = collectRecentTranscripts(meeting);
  const speaker = getSpeakerLabel(meeting, segment.userId);

  console.log(
    `[live-voice][gate] candidate text="${segment.text.slice(0, 120)}"${
      segment.text.length > 120 ? "..." : ""
    } speaker=${speaker}`,
  );
  const systemPrompt =
    "You are Chronote, the meeting notes bot. Decide whether to speak aloud, issue an end meeting command, or do nothing. " +
    "Only respond when the speaker is directly addressing you and a short verbal reply would be helpful. " +
    "Only return command_end when the speaker is explicitly asking you to end the meeting, disconnect, leave, or stop recording. " +
    'Return EXACTLY one JSON object, no prose. Schema: {"action": "respond" | "command_end" | "none"}. ' +
    "Return none if you are unsure, the request is ambiguous, or unrelated. " +
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
      temperature: 0,
    });

    const content = completion.choices[0].message.content ?? "";
    const finish = completion.choices[0].finish_reason;
    console.log(
      `[live-voice][gate] model=${config.liveVoice.gateModel} finish=${finish} raw=${content}`,
    );

    if (!content.trim()) {
      console.warn("[live-voice][gate] empty content from gate model");
      return { action: "none" };
    }

    const parsed = JSON.parse(content) as GateDecision;
    if (
      parsed.action !== "respond" &&
      parsed.action !== "command_end" &&
      parsed.action !== "none"
    ) {
      return { action: "none" };
    }
    return { action: parsed.action };
  } catch (error) {
    console.error("Live voice gate failed:", error);
    return { action: "none" };
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

function resolveBotUserId(meeting: MeetingData): string | undefined {
  return meeting.guild.members.me?.user.id || meeting.creator.client.user?.id;
}

function enqueueLiveVoice(
  meeting: MeetingData,
  text: string,
  priority: "high" | "normal" = "normal",
  onBeforePlay?: (meeting: MeetingData) => void,
): boolean {
  const botUserId = resolveBotUserId(meeting);
  if (!botUserId) {
    console.warn("Could not determine bot user id for live voice reply.");
    return false;
  }
  if (!meeting.ttsQueue) {
    console.warn("Live voice reply dropped because TTS queue is unavailable.");
    return false;
  }
  const voice = resolveTtsVoice(
    meeting.liveVoiceTtsVoice,
    config.liveVoice.ttsVoice,
  );
  const enqueued = meeting.ttsQueue.enqueue({
    text,
    voice,
    userId: botUserId,
    source: "live_voice",
    priority,
    onBeforePlay,
  });
  if (!enqueued) {
    console.warn("Live voice reply dropped because TTS queue is full.");
  }
  return enqueued;
}

function getActivePendingCommand(meeting: MeetingData) {
  const pending = meeting.liveVoiceCommandPending;
  if (!pending) return undefined;
  if (pending.expiresAt <= Date.now()) {
    meeting.liveVoiceCommandPending = undefined;
    return undefined;
  }
  return pending;
}

async function classifyConfirmation(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<ConfirmationDecision> {
  const speaker = getSpeakerLabel(meeting, segment.userId);
  const systemPrompt =
    "You are a confirmation classifier for Chronote. Determine if the speaker confirms, denies, or is unclear about ending the meeting. " +
    'Return EXACTLY one JSON object, no prose. Schema: {"decision": "confirm" | "deny" | "unclear"}. ' +
    "Do not require the bot name to be mentioned. If the response is unrelated or ambiguous, return unclear.";
  const userPrompt = `Response (${new Date(segment.timestamp).toISOString()}): ${speaker}: ${segment.text}`;

  try {
    const completion = await openAIClient.chat.completions.create({
      model: config.liveVoice.gateModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: config.liveVoice.gateMaxOutputTokens,
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const content = completion.choices[0].message.content ?? "";
    const finish = completion.choices[0].finish_reason;
    console.log(
      `[live-voice][confirm] model=${config.liveVoice.gateModel} finish=${finish} raw=${content}`,
    );

    if (!content.trim()) {
      console.warn("[live-voice][confirm] empty content from gate model");
      return { decision: "unclear" };
    }

    const parsed = JSON.parse(content) as ConfirmationDecision;
    if (
      parsed.decision !== "confirm" &&
      parsed.decision !== "deny" &&
      parsed.decision !== "unclear"
    ) {
      return { decision: "unclear" };
    }
    return parsed;
  } catch (error) {
    console.error("Live voice confirmation failed:", error);
    return { decision: "unclear" };
  }
}

function startCommandConfirmation(meeting: MeetingData, segment: LiveSegment) {
  if (meeting.liveVoiceCommandPending) {
    return;
  }
  if (!canUserEndMeeting(meeting, segment.userId)) {
    console.warn(
      `[live-voice][confirm] user ${segment.userId} lacks permission to end meeting.`,
    );
    return;
  }
  const now = Date.now();
  meeting.liveVoiceCommandPending = {
    type: "end_meeting",
    userId: segment.userId,
    requestedAt: now,
    expiresAt: now + COMMAND_CONFIRM_TIMEOUT_MS,
  };
  const enqueued = enqueueLiveVoice(meeting, COMMAND_CONFIRM_PROMPT, "high");
  if (!enqueued) {
    meeting.liveVoiceCommandPending = undefined;
    console.error(
      "[live-voice][confirm] Failed to enqueue end-meeting confirmation prompt. Dropping pending command.",
    );
  }
}

function resolveLiveVoiceFlags(meeting: MeetingData): LiveVoiceFlags {
  return {
    liveVoiceEnabled: Boolean(meeting.liveVoiceEnabled),
    liveVoiceCommandsEnabled: Boolean(meeting.liveVoiceCommandsEnabled),
  };
}

function isLiveVoiceActive(flags: LiveVoiceFlags): boolean {
  return flags.liveVoiceEnabled || flags.liveVoiceCommandsEnabled;
}

async function handlePendingCommandIfAny(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<boolean> {
  const pending = getActivePendingCommand(meeting);
  if (!pending) return false;
  if (segment.userId !== pending.userId) return true;

  const confirmation = await classifyConfirmation(meeting, segment);
  if (confirmation.decision === "confirm") {
    meeting.liveVoiceCommandPending = undefined;
    if (meeting.finishing || meeting.finished) return true;
    if (!canUserEndMeeting(meeting, segment.userId)) {
      console.warn(
        `[live-voice][confirm] user ${segment.userId} lacks permission to end meeting.`,
      );
      return true;
    }
    if (meeting.onEndMeeting) {
      await meeting.onEndMeeting(meeting);
    } else {
      console.warn("Live voice confirm had no end meeting handler.");
    }
    return true;
  }
  if (confirmation.decision === "deny") {
    meeting.liveVoiceCommandPending = undefined;
    const botUserId = resolveBotUserId(meeting);
    const cueEnqueued = botUserId
      ? enqueueDenialCue(meeting, botUserId)
      : false;
    if (!cueEnqueued) {
      enqueueLiveVoice(meeting, COMMAND_DENY_PROMPT, "high");
    }
  }
  return true;
}

async function handleGateDecision(
  meeting: MeetingData,
  segment: LiveSegment,
  decision: GateDecision,
  flags: LiveVoiceFlags,
): Promise<void> {
  if (decision.action === "command_end") {
    if (!flags.liveVoiceCommandsEnabled) return;
    startCommandConfirmation(meeting, segment);
    return;
  }
  if (decision.action !== "respond") return;
  if (!flags.liveVoiceEnabled) return;

  const botUserId = resolveBotUserId(meeting);
  if (botUserId) {
    startThinkingCueLoop(meeting, botUserId);
  }

  let reply: string | undefined;
  try {
    reply = await generateReply(meeting, segment);
  } finally {
    if (!reply && botUserId) {
      stopThinkingCueLoop(meeting);
    }
  }
  if (!reply) return;

  console.log(
    `[live-voice][speak] replying="${reply.slice(0, 120)}"${
      reply.length > 120 ? "..." : ""
    }`,
  );
  const enqueued = enqueueLiveVoice(
    meeting,
    reply,
    "high",
    botUserId ? stopThinkingCueLoop : undefined,
  );
  if (!enqueued && botUserId) {
    stopThinkingCueLoop(meeting);
  }
}

export async function maybeRespondLive(
  meeting: MeetingData,
  segment: LiveSegment,
): Promise<void> {
  if (!segment.text.trim()) return;

  const flags = resolveLiveVoiceFlags(meeting);
  if (!isLiveVoiceActive(flags)) return;

  const handledPending = await handlePendingCommandIfAny(meeting, segment);
  if (handledPending) return;

  if (!isAddressed(segment.text, meeting)) return;

  const decision = await shouldAct(meeting, segment);
  await handleGateDecision(meeting, segment, decision, flags);
}
