import OpenAI from "openai";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  CHANNELS,
  OPENAI_API_KEY,
  OPENAI_ORGANIZATION_ID,
  OPENAI_PROJECT_ID,
  SAMPLE_RATE,
  TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
  TRANSCRIPTION_BREAK_DURATION,
  TRANSCRIPTION_LOGPROB_CUTOFF,
  TRANSCRIPTION_MAX_CONCURRENT,
  TRANSCRIPTION_MAX_QUEUE,
  TRANSCRIPTION_MAX_RETRIES,
  TRANSCRIPTION_RATE_MIN_TIME,
  TRANSCRIPTION_NO_SPEECH_PROBABILITY_CUTOFF,
  TRANSCRIPTION_LOGPROB_HARD_CUTOFF,
  TRANSCRIPTION_COMPRESSION_RATIO_CUTOFF,
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
import { TranscriptionVerbose } from "openai/src/resources/audio/transcriptions";

const openAIClient = new OpenAI({
  apiKey: OPENAI_API_KEY,
  organization: OPENAI_ORGANIZATION_ID,
  project: OPENAI_PROJECT_ID,
});

async function transcribeInternal(
  meeting: MeetingData,
  file: string,
): Promise<string> {
  const transcription = await openAIClient.audio.transcriptions.create({
    file: createReadStream(file),
    model: "gpt-4o-transcribe",
    language: "en",
    prompt: getTranscriptionKeywords(meeting),
    temperature: 0,
    response_format: "json",
  });

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
      model: "gpt-4o",
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

// Get keywords from the server that are likely to help the translation, such as server name, channel names, role names, and attendee names
export function getTranscriptionKeywords(meeting: MeetingData): string {
  const serverName = meeting.voiceChannel.guild.name;
  const attendees = Array.from(meeting.attendance)
    .map((attendee) => `"${attendee}"`)
    .join(", ");
  return `${serverName}, ${attendees}`;
}

export async function getTranscriptionCleanupSystemPrompt(
  meeting: MeetingData,
): Promise<string> {
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
  const prompt =
    "You are a helpful Discord bot that records meetings and provides transcriptions. " +
    "Your task is to correct any spelling discrepancies in the transcribed text, and to correct anything that could've been mis-transcribed. " +
    "Remove any lines that are likely mis-transcriptions due to the Whisper model being sent non-vocal audio like breathing or typing, but only if the certainty is high. " +
    "Only make changes if you are confident it would not alter the meaning of the transcription. " +
    "Output only the altered transcription, in the same format it was received in. " +
    "Make sure to output the entirety of the conversation, regardless of the length. " +
    "The meeting attendees are: " +
    Array.from(meeting.attendance).join(", ") +
    ".\n" +
    `This meeting is happening in a discord named: "${serverName}", with a description of "${serverDescription}", in a voice channel named ${meeting.voiceChannel.name}.\n` +
    `The roles available to users in this server are: ${roles}.\n` +
    `The upcoming events happening in this server are: ${events}.\n` +
    `The channels in this server are: ${channelNames}.`;

  return prompt;
}

export async function getTodoListSystemPrompt(
  meeting: MeetingData,
): Promise<string> {
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
  const prompt =
    "You are a helpful Discord bot that records meetings and provides transcriptions. " +
    "Your task is to create a list of todo items based upon the provided transcription. " +
    'If there are no action items, return only the phrase "none". ' +
    "Group tasks by name, grouping together names for tasks that are shared amongst multiple members. Display action items as \" - *name*:\\n\\t*Task*\".  The name may be omitted if the owner of the task is not clear, or use the speaker's name if it's likely the task is meant for them. " +
    "The meeting attendees are: " +
    Array.from(meeting.attendance).join(", ") +
    ".\n" +
    `This meeting is happening in a discord named: "${serverName}", with a description of ${serverDescription}, in a voice channel named ${meeting.voiceChannel.name}.\n` +
    `The roles available to users in this server are: ${roles}.\n` +
    `The upcoming events happening in this server are: ${events}.\n` +
    `The channels in this server are: ${channelNames}.`;

  return prompt;
}

export async function getTodoList(meeting: MeetingData): Promise<string> {
  const systemPrompt = await getTodoListSystemPrompt(meeting);
  const output = await chat(meeting, {
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

  // Extremely hacky way to return nothing. The system prompt seems to refuse to answer nothing at all, but will happily just return a certain phrase.
  if (
    !output ||
    output.trim().toLowerCase() === "none" ||
    output.trim().toLowerCase() === '"none"'
  ) {
    return "";
  }

  return output;
}

export async function getSummarySystemPrompt(
  meeting: MeetingData,
): Promise<string> {
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
  const prompt =
    "You are a helpful Discord bot that records meetings and provides transcriptions. " +
    "Your task is to create a succinct summary of the meeting based upon the provided transcription, including Summary, Discussion Points, Action Items, and Next Steps sections if appropriate." +
    "The meeting attendees are: " +
    Array.from(meeting.attendance).join(", ") +
    ".\n" +
    `This meeting is happening in a discord named: "${serverName}", with a description of ${serverDescription}, in a voice channel named ${meeting.voiceChannel.name}.\n` +
    `The roles available to users in this server are: ${roles}.\n` +
    `The upcoming events happening in this server are: ${events}.\n` +
    `The channels in this server are: ${channelNames}.`;

  return prompt;
}

export async function getSummary(meeting: MeetingData): Promise<string> {
  const systemPrompt = await getSummarySystemPrompt(meeting);
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

export async function getImage(meeting: MeetingData): Promise<string> {
  const imagePrompt = await chat(meeting, {
    messages: [
      {
        role: "system",
        content:
          "Generate a concise, focused image prompt for DALL-E based on the main ideas from the meeting transcript. Avoid any text, logos, or complex symbols, and limit the inclusion of characters to a single figure at most, if any. Instead, suggest a simple, clear visual concept or scene using objects, environments, or abstract shapes. Ensure the prompt guides DALL-E to produce a visually cohesive and refined image with attention to detail, while avoiding any elements that AI image generation commonly mishandles. Keep the description straightforward to ensure the final image remains polished and coherent. Ensure it generates no text.",
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

export async function getNotesSystemPrompt(
  meeting: MeetingData,
): Promise<string> {
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

  const prompt = `"You are a highly versatile assistant that records and transcribes Discord conversations. Your task is to create concise and insightful notes from the provided transcription. Adapt the format based on the context of the conversation, whether it's a meeting, a TTRPG session, or a general discussion. Use the following guidelines:

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
