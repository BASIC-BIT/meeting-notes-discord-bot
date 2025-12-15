import OpenAI from "openai";
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
  CHANNELS,
  SAMPLE_RATE,
  TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
  TRANSCRIPTION_BREAK_DURATION,
  // TRANSCRIPTION_COMPRESSION_RATIO_CUTOFF,
  // TRANSCRIPTION_LOGPROB_CUTOFF,
  // TRANSCRIPTION_LOGPROB_HARD_CUTOFF,
  TRANSCRIPTION_MAX_CONCURRENT,
  TRANSCRIPTION_MAX_QUEUE,
  TRANSCRIPTION_MAX_RETRIES,
  // TRANSCRIPTION_NO_SPEECH_PROBABILITY_CUTOFF,
  TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD,
  TRANSCRIPTION_RATE_MIN_TIME,
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
// import { Transcription, TranscriptionVerbose } from "openai/resources/audio/transcriptions";

const openAIClient = new OpenAI({
  apiKey: config.openai.apiKey,
  organization: config.openai.organizationId,
  project: config.openai.projectId,
});

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

async function transcribeInternal(
  meeting: MeetingData,
  file: string,
): Promise<string> {
  const glossaryContent = getTranscriptionGlossaryContent(meeting);
  const prompt = getTranscriptionKeywords(meeting);

  const transcription = await openAIClient.audio.transcriptions.create({
    file: createReadStream(file),
    model: "gpt-4o-transcribe",
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
    return ""; // Return empty string for segments with no actual speech
  }

  return transcription.text;

  // return cleanupTranscriptionResponse(transcription);
}

// function cleanupTranscriptionResponse(response: TranscriptionVerbose): string {
//   if (!response.segments) {
//     return "";
//   }

//   return response.segments
//     .filter(
//       (segment) =>
//         // Only remove lines from transcription if no_speech_prob is very high AND logprob is very low, OR if logprob is insanely low, OR if compression ratio is insanely high
//         (segment.no_speech_prob < TRANSCRIPTION_NO_SPEECH_PROBABILITY_CUTOFF ||
//           segment.avg_logprob > TRANSCRIPTION_LOGPROB_CUTOFF) &&
//         segment.avg_logprob > TRANSCRIPTION_LOGPROB_HARD_CUTOFF &&
//         segment.compression_ratio < TRANSCRIPTION_COMPRESSION_RATIO_CUTOFF,
//     )
//     .map((segment) => segment.text)
//     .join("")
//     .trim();
// }

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

async function transcribe(meeting: MeetingData, file: string): Promise<string> {
  return await policies.execute(() =>
    limiter.schedule(() => transcribeInternal(meeting, file)),
  );
}

export async function transcribeSnippet(
  meeting: MeetingData,
  snippet: AudioSnippet,
): Promise<string> {
  const tempPcmFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}_transcript.pcm`;
  const tempWavFileName = `./temp_snippet_${snippet.userId}_${snippet.timestamp}.wav`;

  // Ensure the directories exist
  const tempDir = "./";
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  // Write the PCM buffer to a file
  const buffer = Buffer.concat(snippet.chunks);
  writeFileSync(tempPcmFileName, buffer);

  // Convert PCM to WAV using ffmpeg
  await new Promise<void>((resolve, reject) => {
    ffmpeg(tempPcmFileName)
      .inputOptions([`-f s16le`, `-ar ${SAMPLE_RATE}`, `-ac ${CHANNELS}`])
      .outputOptions([`-f wav`, `-c:a pcm_s16le`])
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
    const transcription = await transcribe(meeting, tempWavFileName);

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
  const systemPrompt = await getTranscriptionCleanupSystemPrompt(meeting);
  return await chat(meeting, {
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: transcription,
      },
    ],
    temperature: 0,
  });
}

type ChatInput = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  "model" | "user"
>;

async function chat(meeting: MeetingData, body: ChatInput): Promise<string> {
  let output: string = "";
  let done: boolean = false;
  let count = 0;
  while (!done) {
    const response = await openAIClient.chat.completions.create({
      model: "gpt-5.1",
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

export async function getTranscriptionCleanupSystemPrompt(
  meeting: MeetingData,
): Promise<string> {
  // Build context data (without memory - too early in process)
  const contextData = await buildMeetingContext(meeting, false);
  const formattedContext = formatContextForPrompt(contextData, "transcription");

  const serverName = meeting.guild.name;
  const serverDescription = meeting.guild.description;
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

  let prompt =
    "You are a helpful Discord bot that records meetings and provides transcriptions. ";

  // Add context from context service if available
  if (formattedContext) {
    prompt += formattedContext;
  }

  prompt +=
    "\nYour task is to correct any spelling discrepancies in the transcribed text, and to correct anything that could've been mis-transcribed. " +
    "Remove any lines that are likely mis-transcriptions due to the Whisper model being sent non-vocal audio like breathing or typing, but only if the certainty is high. " +
    "Only make changes if you are confident it would not alter the meaning of the transcription. " +
    "Output only the altered transcription, in the same format it was received in. " +
    "Make sure to output the entirety of the conversation, regardless of the length. " +
    "\nThe meeting attendees are: " +
    Array.from(meeting.attendance).join(", ") +
    ".\n" +
    `This meeting is happening in a discord named: "${serverName}", with a description of "${serverDescription}", in a voice channel named ${meeting.voiceChannel.name}.\n` +
    `The roles available to users in this server are: ${roles}.\n` +
    `The upcoming events happening in this server are: ${events}.\n` +
    `The channels in this server are: ${channelNames}.`;

  return prompt;
}

export async function getImage(meeting: MeetingData): Promise<string> {
  // Build context data (without memory - visual generation doesn't need history)
  const contextData = await buildMeetingContext(meeting, false);
  const formattedContext = formatContextForPrompt(contextData, "image");

  let systemContent =
    "Generate a concise, focused image prompt for DALL-E based on the main ideas from the meeting transcript. ";

  // Add context from context service if available
  if (formattedContext) {
    // Keep context brief for image generation to avoid confusing DALL-E
    const briefContext = formattedContext.substring(0, 500);
    systemContent += `Context: ${briefContext}. `;
  }

  systemContent +=
    "Avoid any text, logos, or complex symbols, and limit the inclusion of characters to a single figure at most, if any. Instead, suggest a simple, clear visual concept or scene using objects, environments, or abstract shapes. Ensure the prompt guides DALL-E to produce a visually cohesive and refined image with attention to detail, while avoiding any elements that AI image generation commonly mishandles. Keep the description straightforward to ensure the final image remains polished and coherent. Ensure it generates no text.";

  const imagePrompt = await chat(meeting, {
    messages: [
      {
        role: "system",
        content: systemContent,
      },
      {
        role: "user",
        content: meeting.finalTranscript!,
      },
    ],
    temperature: 0.5,
  });

  console.log(imagePrompt);

  const response = await openAIClient.images.generate({
    model: "dall-e-3",
    size: "1024x1024",
    quality: "hd",
    n: 1,
    prompt: imagePrompt!,
  });

  const output = response.data?.[0]?.url;

  return output || "";
}

const MAX_CHAT_LOG_PROMPT_LENGTH = 1500;
const MAX_CHAT_LOG_LINES = 20;

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
  const recent = relevant.slice(-MAX_CHAT_LOG_LINES);
  if (recent.length === 0) {
    return undefined;
  }

  const combinedLines = recent.map((e) => renderChatEntryLine(e)).join("\n");

  if (combinedLines.length > maxLength) {
    const trimmed = combinedLines.slice(combinedLines.length - maxLength);
    return "...(recent chat truncated)...\n" + trimmed;
  }

  return combinedLines;
}

export async function getNotesSystemPrompt(
  meeting: MeetingData,
): Promise<string> {
  // Build context data with memory if enabled
  const contextData = await buildMeetingContext(meeting, isMemoryEnabled());
  const formattedContext = formatContextForPrompt(contextData, "notes");

  const serverName = meeting.guild.name;
  const serverDescription = meeting.guild.description;
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

  const longStoryTestMode = config.notes.longStoryTestMode;
  const longStoryTargetChars = config.notes.longStoryTargetChars;

  let prompt = `You are Meeting Notes Bot (canonical name "Meeting Notes Bot"), a Discord assistant that records, transcribes, and summarizes conversations. In this server you currently appear as "${botDisplayName}". Follow explicit participant instructions about what to include or omit in the notes, even if they differ from your defaults. Keep the notes concise and proportional to the meeting length—favor clarity over exhaustive detail. Speaker order in the transcript may be imperfect because audio is batched until roughly 5 seconds of silence; avoid strong inferences from ordering or attribution when uncertain. `;

  // Add context from context service if available
  if (formattedContext) {
    prompt += formattedContext;
  }

  if (longStoryTestMode) {
    prompt += `
LOAD TEST MODE - GENERATE AN EXTREMELY LONG STORY FOR EMBED SPLITTING QA:
- Ignore usual brevity and summary expectations; produce a self-contained fictional narrative.
- Use the meeting transcript only as loose inspiration (names, themes) but still generate the full story even if it is empty.
- Target length: at least ${longStoryTargetChars} characters of prose; exceeding the target to complete sections is encouraged.
- Structure the output: 12 numbered chapters ("Chapter 01 - ..." through "Chapter 12 - ..."), each roughly 250-400 words; add an interlude after Chapter 06 of at least 150 words; end with an Epilogue of 300+ words.
- Append an "Appendix: Key Echoes" section with 30 bullet points (12-20 words each) that restate plot beats to add predictable length.
- Keep markdown simple: plain text chapter labels and blank-line separated paragraphs; bullets start with "- "; avoid code fences or tables.
- Do not mention this is a test or talk about token limits; just tell the story.`;

    return prompt;
  }

  // Check if we're in test mode for context debugging
  const contextTestMode = config.context.testMode;

  if (contextTestMode) {
    prompt += `\nTEST MODE - EXPLICIT CONTEXT USAGE:
You MUST actively use ALL provided context in your notes. This is for testing purposes.

REQUIRED ACTIONS:
1. If previous meetings are provided, EXPLICITLY reference them at the start of your notes
2. When someone refers to "last meeting" or "previously discussed", look up the EXACT details from previous meetings
3. Create a "Context Connections" section that lists ALL connections to previous meetings
4. If someone says "the thing I mentioned before", find what that was in previous meetings and NAME IT EXPLICITLY
5. Start your notes with "Previous Context Applied: [list what you found from previous meetings]"

Example: If someone says "I'll eat the thing I mentioned last meeting" and last meeting mentioned "watermelon", you MUST write "They will eat the watermelon (mentioned in previous meeting)"

Your task is to create notes that PROVE the context system is working by explicitly using all available historical data.`;
  } else {
    prompt += `\nYour task is to create concise and insightful notes from the PROVIDED TRANSCRIPTION of THIS CURRENT MEETING. 

CONTEXT USAGE INSTRUCTIONS:
- You have been provided with context that may include:
  - Server context: The overall purpose of this Discord server
  - Channel context: The specific purpose of this voice channel  
  - Previous meetings: Notes from recent meetings in this same channel
  
- ACTIVELY USE previous meeting context when:
  - Someone explicitly references "last meeting", "previously", "as discussed before"
  - Topics directly continue from previous meetings
  - Understanding requires knowledge from previous discussions
  - Action items or decisions reference earlier conversations
  
- When referencing previous meetings:
  - Be specific about what was previously discussed (e.g., "the watermelon mentioned in the previous meeting")
  - Include relevant details from past meetings to provide continuity
  - Help readers understand the full context without having to look up old notes
  
- Keep distinctions clear:
  - Always specify what happened in THIS meeting vs previous meetings
  - Use phrases like "continuing from last meeting where..." or "as previously discussed..."
  - Don't mix up events between meetings, but DO connect related discussions

The goal is to create comprehensive notes that leverage historical context to provide better understanding and continuity.`;
  }

  prompt += `\n\nAdapt the format based on the context of the conversation, whether it's a meeting, a TTRPG session, or a general discussion. Use the following guidelines:

1. **For Meetings or Task-Oriented Discussions**:
   - Provide a **Summary** of key points discussed.
   - List any **Action Items** or **Next Steps**. Ensure tasks are assigned to specific attendees if mentioned.

2. **For TTRPG Sessions or Casual Conversations**:
   - Focus on **Highlights** of what happened, such as important plot developments, character actions, or key decisions made by the participants.
   - Capture any **Open Questions** or decisions that remain unresolved.
   - If there are any **Tasks** (e.g., players needing to follow up on something), list them clearly.

3. **For All Types of Conversations**:
   - Summarize important **takeaways** or **insights** for people who missed the conversation, ensuring these are concise and offer a quick understanding of what was discussed.
   - List any **To-Do Items** or plans, with specific names if people were assigned tasks.

### Additional Inputs:
- **Participant chat/instructions**: ${
    chatContext
      ? "Use the raw chat provided below to honor any explicit include/omit requests."
      : "No additional participant chat was captured; rely on transcript and provided context."
  }
- **Bot identity**: You are "${botDisplayName}" in this server; canonical name is "Meeting Notes Bot".
- **Transcript ordering caution**: Speaker order can be unreliable because audio is batched until ~5 seconds of silence.

${
  chatContext
    ? `Participant chat (recent, raw, chronological):\n${chatContext}`
    : ""
}

### Contextual Information:
- **Discord Server**: "${serverName}" (${serverDescription}).
- **Voice Channel**: ${meeting.voiceChannel.name}.
- **Attendees**: ${Array.from(meeting.attendance).join(", ")}.
- **Available Roles**: ${roles}.
- **Upcoming Events**: ${events}.
- **Available Channels**: ${channelNames}.

Output the notes in a concise, scannable format suitable for the description section of a Discord embed. Do **not** include the server name, channel name, attendees, or date at the top of the main notes, as these are handled separately in the contextual information. Avoid using four hashes (####) for headers, as discord embed markdown only allows for up to three. Omit any sections that have no content.`;

  return prompt;
}

export async function getNotes(meeting: MeetingData): Promise<string> {
  const systemPrompt = await getNotesSystemPrompt(meeting);
  return await chat(meeting, {
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: meeting.finalTranscript!,
      },
    ],
    temperature: 0,
  });
}
