import type OpenAI from "openai";
import type { SpanContext } from "@opentelemetry/api";
import { ChatEntry } from "./types/chat";
import { renderChatEntryLine } from "./utils/chatLog";
import { distance as levenshteinDistance } from "fastest-levenshtein";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  RECORD_SAMPLE_RATE,
  TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
  TRANSCRIPTION_BREAK_DURATION,
  TRANSCRIPTION_MAX_CONCURRENT,
  TRANSCRIPTION_MAX_QUEUE,
  TRANSCRIPTION_MAX_RETRIES,
  TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD,
  TRANSCRIPTION_RATE_MIN_TIME,
  TRANSCRIBE_SAMPLE_RATE,
} from "./constants";
import ffmpeg from "fluent-ffmpeg";
import { AudioSnippet } from "./types/audio";
import {
  bulkhead,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  wrap,
} from "cockatiel";
import { MeetingData } from "./types/meeting-data";
import Bottleneck from "bottleneck";
import {
  buildMeetingContext,
  formatContextForPrompt,
  isMemoryEnabled,
} from "./services/contextService";
import { config } from "./services/configService";
import { formatParticipantLabel } from "./utils/participants";
import { getBotNameVariants } from "./utils/botNames";
import { createOpenAIClient } from "./services/openaiClient";
import { getModelChoice } from "./services/modelFactory";
import {
  getLangfuseChatPrompt,
  type LangfusePromptMeta,
} from "./services/langfusePromptService";
import { isLangfuseTracingEnabled } from "./services/langfuseClient";
import {
  startActiveObservation,
  updateActiveObservation,
  updateActiveTrace,
} from "@langfuse/tracing";
// import { Transcription, TranscriptionVerbose } from "openai/resources/audio/transcriptions";

// Check if transcription is too similar to the prompt or glossary content (likely verbatim output)
function isTranscriptionLikelyPrompt(
  transcription: string,
  fullPrompt: string,
  glossaryContent: string,
): boolean {
  // Normalize all strings for comparison
  const normalizedTranscription = transcription.trim().toLowerCase();
  const normalizedPrompt = fullPrompt.trim().toLowerCase();
  const normalizedGlossary = glossaryContent.trim().toLowerCase();

  // Extract just the first line of the glossary content (Server Name: ...)
  const firstLineOfGlossary = glossaryContent
    .split("\n")[0]
    .trim()
    .toLowerCase();

  // Calculate similarity against the full prompt, just the glossary content, and just the first line
  const distanceFull = levenshteinDistance(
    normalizedTranscription,
    normalizedPrompt,
  );
  const distanceContent = levenshteinDistance(
    normalizedTranscription,
    normalizedGlossary,
  );
  const distanceFirstLine = levenshteinDistance(
    normalizedTranscription,
    firstLineOfGlossary,
  );

  const maxLengthFull = Math.max(
    normalizedTranscription.length,
    normalizedPrompt.length,
  );
  const maxLengthContent = Math.max(
    normalizedTranscription.length,
    normalizedGlossary.length,
  );
  const maxLengthFirstLine = Math.max(
    normalizedTranscription.length,
    firstLineOfGlossary.length,
  );

  const similarityFull = maxLengthFull > 0 ? distanceFull / maxLengthFull : 0;
  const similarityContent =
    maxLengthContent > 0 ? distanceContent / maxLengthContent : 0;
  const similarityFirstLine =
    maxLengthFirstLine > 0 ? distanceFirstLine / maxLengthFirstLine : 0;

  // If similarity is below threshold for any comparison, it's likely the prompt was output verbatim
  return (
    similarityFull < TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD ||
    similarityContent < TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD ||
    similarityFirstLine < TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD
  );
}

type TranscriptionTraceContext = {
  userId: string;
  timestamp: number;
  audioSeconds: number;
  audioBytes: number;
};

async function transcribeInternal(
  meeting: MeetingData,
  file: string,
  context?: TranscriptionTraceContext,
): Promise<string> {
  const glossaryContent = getTranscriptionGlossaryContent(meeting);
  const prompt = getTranscriptionKeywords(meeting);

  const modelChoice = getModelChoice("transcription");
  const traceMetadata = {
    guildId: meeting.guild.id,
    channelId: meeting.voiceChannel.id,
    meetingId: meeting.meetingId,
    snippetUserId: context?.userId,
    snippetTimestamp: context?.timestamp,
    audioSeconds: context?.audioSeconds,
    audioBytes: context?.audioBytes,
    promptLength: prompt.length,
  };

  const runTranscription = async (openAIClient: OpenAI) => {
    const transcription = await openAIClient.audio.transcriptions.create({
      file: createReadStream(file),
      model: modelChoice.model,
      language: "en",
      prompt: prompt,
      temperature: 0,
      response_format: "json",
      // include: ["logprobs"],
    });

    // Check if the transcription is suspiciously similar to the prompt or glossary content
    if (
      isTranscriptionLikelyPrompt(transcription.text, prompt, glossaryContent)
    ) {
      console.warn(
        "Transcription appears to be verbatim prompt output, likely no transcribable audio",
      );
      return "";
    }

    return transcription.text;
  };

  if (!isLangfuseTracingEnabled()) {
    const openAIClient = createOpenAIClient({
      traceName: "transcription",
      generationName: "transcription",
      userId: meeting.creator.id,
      sessionId: meeting.meetingId,
      tags: ["feature:transcription"],
      metadata: traceMetadata,
    });
    return await runTranscription(openAIClient);
  }

  return await startActiveObservation(
    "transcription",
    async () => {
      updateActiveTrace({
        name: "transcription",
        userId: context?.userId,
        tags: ["feature:transcription"],
        metadata: traceMetadata,
      });
      updateActiveObservation(
        {
          input: {
            language: "en",
            prompt,
          },
          model: modelChoice.model,
          modelParameters: {
            temperature: 0,
            response_format: "json",
          },
          metadata: traceMetadata,
        },
        { asType: "generation" },
      );

      const openAIClient = createOpenAIClient({ disableTracing: true });
      const output = await runTranscription(openAIClient);

      const usageDetails = context?.audioSeconds
        ? {
            audioSeconds: Number(context.audioSeconds.toFixed(3)),
          }
        : undefined;
      updateActiveObservation(
        {
          output,
          usageDetails,
        },
        { asType: "generation" },
      );

      return output;
    },
    { asType: "generation" },
  );
}

const retryPolicy = retry(handleAll, {
  maxAttempts: TRANSCRIPTION_MAX_RETRIES,
  backoff: new ExponentialBackoff(),
});
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: TRANSCRIPTION_BREAK_DURATION,
  breaker: new ConsecutiveBreaker(
    TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
  ),
});
const bulkheadPolicy = bulkhead(
  TRANSCRIPTION_MAX_CONCURRENT,
  TRANSCRIPTION_MAX_QUEUE,
);

const policies = wrap(bulkheadPolicy, breakerPolicy, retryPolicy);

const limiter = new Bottleneck({
  minTime: TRANSCRIPTION_RATE_MIN_TIME,
});

async function transcribe(
  meeting: MeetingData,
  file: string,
  context?: TranscriptionTraceContext,
): Promise<string> {
  return await policies.execute(() =>
    limiter.schedule(() => transcribeInternal(meeting, file, context)),
  );
}

export async function transcribeSnippet(
  meeting: MeetingData,
  snippet: AudioSnippet,
  options: { tempSuffix?: string } = {},
): Promise<string> {
  const suffix = options.tempSuffix ? `_${options.tempSuffix}` : "";
  const tempPcmFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}${suffix}_transcript.pcm`;
  const tempWavFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}${suffix}.wav`;

  // Ensure the directories exist
  const tempDir = "./";
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  // Write the PCM buffer to a file
  const buffer = Buffer.concat(snippet.chunks);
  const audioBytes = buffer.length;
  const audioSeconds =
    audioBytes / (RECORD_SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
  writeFileSync(tempPcmFileName, buffer);

  // Convert PCM to WAV using ffmpeg
  await new Promise<void>((resolve, reject) => {
    ffmpeg(tempPcmFileName)
      .inputOptions([
        `-f s16le`,
        `-ar ${RECORD_SAMPLE_RATE}`,
        `-ac ${CHANNELS}`,
      ])
      .outputOptions([
        `-f wav`,
        `-c:a pcm_s16le`,
        `-ar ${TRANSCRIBE_SAMPLE_RATE}`,
      ])
      .on("end", () => {
        resolve();
      })
      .on("error", (err) => {
        console.error(`Error converting PCM to WAV: ${err.message}`);
        reject(err);
      })
      .save(tempWavFileName); // Ensure this is within the promise chain
  });

  try {
    // Transcribe the WAV file
    const transcription = await transcribe(meeting, tempWavFileName, {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      audioSeconds,
      audioBytes,
    });

    // Cleanup temporary files
    if (existsSync(tempPcmFileName)) {
      unlinkSync(tempPcmFileName);
    } else {
      console.log("failed cleaning up temp pcm file, continuing");
    }
    if (existsSync(tempWavFileName)) {
      unlinkSync(tempWavFileName);
    } else {
      console.log("failed cleaning up temp wav file, continuing");
    }

    return transcription;
  } catch (e) {
    console.error(
      `Failed to transcribe snippet for user ${snippet.userId}:`,
      e,
    );

    // Cleanup temporary files on error
    if (existsSync(tempPcmFileName)) {
      unlinkSync(tempPcmFileName);
    } else {
      console.log("failed cleaning up temp pcm file, continuing");
    }
    if (existsSync(tempWavFileName)) {
      unlinkSync(tempWavFileName);
    } else {
      console.log("failed cleaning up temp wav file, continuing");
    }

    return `[Transcription failed]`;
  }
}

export async function cleanupTranscription(
  meeting: MeetingData,
  transcription: string,
) {
  const { messages, langfusePrompt } = await getTranscriptionCleanupPrompt(
    meeting,
    transcription,
  );
  const modelChoice = getModelChoice("transcriptionCleanup");
  return await chat(
    meeting,
    {
      messages: [...messages],
      temperature: 0,
    },
    {
      model: modelChoice.model,
      traceName: "transcription-cleanup",
      generationName: "transcription-cleanup",
      tags: ["feature:transcription_cleanup"],
      langfusePrompt,
      parentSpanContext: meeting.langfuseParentSpanContext,
    },
  );
}

type ChatInput = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  "model" | "user"
>;

type ChatOptions = {
  model?: string;
  traceName?: string;
  generationName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  langfusePrompt?: LangfusePromptMeta;
  parentSpanContext?: SpanContext;
};

async function chat(
  meeting: MeetingData,
  body: ChatInput,
  options: ChatOptions = {},
): Promise<string> {
  const model = options.model ?? getModelChoice("notes").model;
  const openAIClient = createOpenAIClient({
    traceName: options.traceName ?? "notes",
    generationName: options.generationName ?? "notes",
    userId: meeting.creator.id,
    sessionId: meeting.meetingId,
    tags: options.tags ?? ["feature:notes"],
    metadata: {
      guildId: meeting.guild.id,
      channelId: meeting.voiceChannel.id,
      ...options.metadata,
    },
    langfusePrompt: options.langfusePrompt,
    parentSpanContext: options.parentSpanContext,
  });
  let output: string = "";
  let done: boolean = false;
  let count = 0;
  while (!done) {
    const response = await openAIClient.chat.completions.create({
      model,
      user: meeting.creator.id,
      ...body,
    });
    console.log(response.choices[0].finish_reason);
    if (response.choices[0].finish_reason !== "length") {
      done = true;
    }
    const responseValue = response.choices[0].message.content;
    output += responseValue;
    body.messages.push({
      role: "assistant",
      content: responseValue,
    });
    count++;
  }
  console.log(`Chat took ${count} calls to fully complete due to length.`);
  return output;
}

// Generate the inner content of the glossary (without wrapper tags)
function getTranscriptionGlossaryContent(meeting: MeetingData): string {
  const serverName = meeting.voiceChannel.guild.name;
  const channelName = meeting.voiceChannel.name;
  const serverDescription = meeting.guild.description || "";
  const attendees = Array.from(meeting.attendance).join(", ");

  let content = `Server Name: ${serverName}
Channel: ${channelName}`;

  if (serverDescription) {
    content += `\nServer Description: ${serverDescription}`;
  }

  content += `\nAttendees: ${attendees}`;

  const botNames = getBotNameVariants(
    meeting.guild.members.me,
    meeting.guild.client.user,
  );
  if (botNames.length > 0) {
    content += `\nBot Names: ${botNames.join(", ")}`;
  }

  return content;
}

// Get keywords from the server that are likely to help the translation, such as server name, channel names, role names, and attendee names
export function getTranscriptionKeywords(meeting: MeetingData): string {
  let content = getTranscriptionGlossaryContent(meeting);

  // Add meeting context if provided
  if (meeting.meetingContext) {
    content += `\nMeeting Context: ${meeting.meetingContext}`;
  }

  return `<glossary>(do not include in transcript):
${content}
</glossary>`;
}

export async function getTranscriptionCleanupPrompt(
  meeting: MeetingData,
  transcription: string,
) {
  const contextData = await buildMeetingContext(meeting, false);
  const formattedContext = formatContextForPrompt(contextData, "transcription");

  const serverName = meeting.guild.name;
  const serverDescription = meeting.guild.description ?? "";
  const roles = meeting.guild.roles
    .valueOf()
    .map((role) => role.name)
    .join(", ");
  const events = meeting.guild.scheduledEvents
    .valueOf()
    .map((event) => event.name)
    .join(", ");
  const channelNames = meeting.guild.channels
    .valueOf()
    .map((channel) => channel.name)
    .join(", ");

  return await getLangfuseChatPrompt({
    name: config.langfuse.transcriptionCleanupPromptName,
    variables: {
      formattedContext,
      attendees: Array.from(meeting.attendance).join(", "),
      serverName,
      serverDescription,
      voiceChannelName: meeting.voiceChannel.name,
      roles,
      events,
      channelNames,
      transcription,
    },
  });
}

export async function getImage(meeting: MeetingData): Promise<string> {
  // Build context data (without memory - visual generation doesn't need history)
  const contextData = await buildMeetingContext(meeting, false);
  const formattedContext = formatContextForPrompt(contextData, "image");
  const briefContext = formattedContext
    ? formattedContext.substring(0, 500)
    : "";
  const briefContextBlock = briefContext ? `Context: ${briefContext}. ` : "";
  const { messages, langfusePrompt } = await getLangfuseChatPrompt({
    name: config.langfuse.imagePromptName,
    variables: {
      briefContextBlock,
      transcript: meeting.finalTranscript ?? "",
    },
  });

  const imagePrompt = await chat(
    meeting,
    {
      messages: [...messages],
      temperature: 0.5,
    },
    {
      traceName: "image-prompt",
      generationName: "image-prompt",
      tags: ["feature:image_prompt"],
      langfusePrompt,
      parentSpanContext: meeting.langfuseParentSpanContext,
    },
  );

  console.log(imagePrompt);

  const imageModel = getModelChoice("image");
  const imageClient = createOpenAIClient({
    traceName: "image",
    generationName: "image",
    userId: meeting.creator.id,
    sessionId: meeting.meetingId,
    tags: ["feature:image"],
    metadata: {
      guildId: meeting.guild.id,
      channelId: meeting.voiceChannel.id,
    },
    parentSpanContext: meeting.langfuseParentSpanContext,
  });
  const response = await imageClient.images.generate({
    model: imageModel.model,
    size: "1024x1024",
    quality: "hd",
    n: 1,
    prompt: imagePrompt!,
  });

  const output = response.data?.[0]?.url;

  return output || "";
}

const MAX_CHAT_LOG_PROMPT_LENGTH = 20000;

function formatChatLogForPrompt(
  chatLog: ChatEntry[],
  maxLength: number = MAX_CHAT_LOG_PROMPT_LENGTH,
): string | undefined {
  if (!chatLog || chatLog.length === 0) {
    return undefined;
  }

  // Drop obvious noise so participant instructions stay visible
  const filtered = chatLog.filter((entry) => entry.type === "message");

  const relevant = filtered.length > 0 ? filtered : chatLog;
  const combinedLines = relevant.map((e) => renderChatEntryLine(e)).join("\n");
  if (!combinedLines) {
    return undefined;
  }

  if (combinedLines.length > maxLength) {
    const trimmed = combinedLines.slice(combinedLines.length - maxLength);
    return "...(recent chat truncated)...\n" + trimmed;
  }

  return combinedLines;
}

function formatParticipantRoster(meeting: MeetingData): string | undefined {
  const participants = Array.from(meeting.participants.values());
  if (participants.length === 0) {
    return undefined;
  }
  return participants
    .map((participant) => {
      const preferred = formatParticipantLabel(participant, {
        includeUsername: false,
        fallbackName: participant.username,
      });
      const username = participant.username || participant.tag || "unknown";
      const displayName = participant.displayName ?? "-";
      const serverNickname = participant.serverNickname ?? "-";
      const profile = `https://discord.com/users/${participant.id}`;
      return `- ${preferred} | username: ${username} | display name: ${displayName} | server nickname: ${serverNickname} | id: ${participant.id} | profile: ${profile}`;
    })
    .join("\n");
}

export async function getNotesPrompt(meeting: MeetingData) {
  // Build context data with memory if enabled
  const contextData = await buildMeetingContext(meeting, isMemoryEnabled());
  const formattedContext = formatContextForPrompt(contextData, "notes");

  const serverName = meeting.guild.name;
  const serverDescription = meeting.guild.description ?? "";
  const roles = meeting.guild.roles
    .valueOf()
    .map((role) => role.name)
    .join(", ");
  const events = meeting.guild.scheduledEvents
    .valueOf()
    .map((event) => event.name)
    .join(", ");
  const channelNames = meeting.guild.channels
    .valueOf()
    .map((channel) => channel.name)
    .join(", ");

  const botDisplayName =
    meeting.guild.members.me?.displayName ||
    meeting.guild.members.me?.nickname ||
    meeting.guild.members.me?.user.username ||
    "Meeting Notes Bot";

  const chatContext = formatChatLogForPrompt(meeting.chatLog);
  const participantRoster = formatParticipantRoster(meeting);

  const longStoryTestMode = config.notes.longStoryTestMode;
  const contextTestMode = config.context.testMode;
  const promptName = longStoryTestMode
    ? config.langfuse.notesLongStoryPromptName
    : contextTestMode
      ? config.langfuse.notesContextTestPromptName
      : config.langfuse.notesPromptName;

  return await getLangfuseChatPrompt({
    name: promptName,
    variables: {
      formattedContext,
      botDisplayName,
      chatContextInstruction: chatContext
        ? "Use the raw chat provided below to honor any explicit include or omit requests."
        : "No additional participant chat was captured; rely on transcript and provided context.",
      chatContextBlock: chatContext
        ? `Participant chat (recent, raw, chronological):\n${chatContext}`
        : "",
      participantRoster: participantRoster ?? "No participant roster captured.",
      serverName,
      serverDescription,
      voiceChannelName: meeting.voiceChannel.name,
      attendees: Array.from(meeting.attendance).join(", "),
      roles,
      events,
      channelNames,
      longStoryTargetChars: config.notes.longStoryTargetChars,
      transcript: meeting.finalTranscript ?? "",
    },
  });
}

export async function getNotes(meeting: MeetingData): Promise<string> {
  const { messages, langfusePrompt } = await getNotesPrompt(meeting);
  return await chat(
    meeting,
    {
      messages: [...messages],
      temperature: 0,
    },
    {
      traceName: "notes",
      generationName: "notes",
      tags: ["feature:notes"],
      langfusePrompt,
      parentSpanContext: meeting.langfuseParentSpanContext,
    },
  );
}
