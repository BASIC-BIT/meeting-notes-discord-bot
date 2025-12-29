import OpenAI from "openai";
import { config } from "./configService";

export type MeetingSummaries = {
  summarySentence?: string;
  summaryLabel?: string;
};

type MeetingSummaryInput = {
  notes: string;
  serverName: string;
  channelName: string;
  tags?: string[];
  now?: Date;
  previousSummarySentence?: string;
  previousSummaryLabel?: string;
};

function formatFullDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function parseMeetingSummaryResponse(
  content: string,
): MeetingSummaries | undefined {
  if (!content || !content.trim()) return undefined;
  try {
    const parsed = JSON.parse(content) as {
      summarySentence?: string;
      summaryLabel?: string;
    };
    const summarySentence =
      typeof parsed.summarySentence === "string"
        ? parsed.summarySentence.trim()
        : undefined;
    const summaryLabel =
      typeof parsed.summaryLabel === "string"
        ? parsed.summaryLabel.trim()
        : undefined;
    return {
      summarySentence: summarySentence || undefined,
      summaryLabel: summaryLabel || undefined,
    };
  } catch (error) {
    console.error("Failed to parse meeting summaries:", error);
    return undefined;
  }
}

export async function generateMeetingSummaries(
  input: MeetingSummaryInput,
): Promise<MeetingSummaries> {
  const now = input.now ?? new Date();
  const tagLine = input.tags?.length ? input.tags.join(", ") : "None";
  const previousSentence = input.previousSummarySentence?.trim();
  const previousLabel = input.previousSummaryLabel?.trim();

  const systemPrompt =
    "You are Chronote, a Discord meeting notes bot. " +
    "Create two summaries from the meeting notes. " +
    "summarySentence must be exactly one sentence, clear and friendly. " +
    "summaryLabel must be five words or fewer, no punctuation. " +
    "Do not include URLs, links, IDs, mentions, hashtags, or markdown. " +
    "These summaries may be read aloud, so avoid long numeric strings. " +
    "If the previous summaries still accurately describe the meeting and the new notes changes are minor, return the previous summaries unchanged. " +
    'Return ONLY JSON: {"summarySentence":"...","summaryLabel":"..."}';

  const userPrompt = [
    `Today is ${formatFullDate(now)}.`,
    `Server: ${input.serverName}`,
    `Channel: ${input.channelName}`,
    `Tags: ${tagLine}`,
    previousSentence || previousLabel
      ? `Previous summary sentence: ${previousSentence || "(none)"}\nPrevious summary label: ${previousLabel || "(none)"}`
      : "Previous summaries: (none)",
    "Notes:",
    input.notes,
  ].join("\n");

  try {
    const completion = await new OpenAI({
      apiKey: config.openai.apiKey,
      organization: config.openai.organizationId,
      project: config.openai.projectId,
    }).chat.completions.create({
      model: config.notes.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
      max_completion_tokens: 160,
    });
    const content = completion.choices[0]?.message?.content ?? "";
    return parseMeetingSummaryResponse(content) ?? {};
  } catch (error) {
    console.error("Failed to generate meeting summaries:", error);
    return {};
  }
}
