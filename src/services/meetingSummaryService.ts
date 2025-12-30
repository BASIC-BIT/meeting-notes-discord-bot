import { config } from "./configService";
import type { SpanContext } from "@opentelemetry/api";
import { formatLongDate } from "../utils/time";
import { getLangfuseTextPrompt } from "./langfusePromptService";
import { createOpenAIClient } from "./openaiClient";
import { getModelChoice } from "./modelFactory";

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
  parentSpanContext?: SpanContext;
};

function normalizeSummarySentence(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const sentenceMarkers = trimmed.match(/[.!?]/g);
  if (sentenceMarkers && sentenceMarkers.length > 1) {
    return undefined;
  }
  return trimmed;
}

function normalizeSummaryLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 5) return undefined;
  if (!/^[A-Za-z0-9 ]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

async function getMeetingSummarySystemPrompt() {
  return await getLangfuseTextPrompt({
    name: config.langfuse.meetingSummaryPromptName,
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
    const summarySentence = normalizeSummarySentence(parsed.summarySentence);
    const summaryLabel = normalizeSummaryLabel(parsed.summaryLabel);
    if (!summarySentence && !summaryLabel) {
      return undefined;
    }
    return {
      summarySentence,
      summaryLabel,
    };
  } catch (error) {
    console.error("Failed to parse meeting summaries:", error);
    return undefined;
  }
}

/**
 * Generates AI-based summaries for a meeting from notes and context.
 * Returns an empty object when the model response is missing or invalid.
 */
export async function generateMeetingSummaries(
  input: MeetingSummaryInput,
): Promise<MeetingSummaries> {
  const now = input.now ?? new Date();
  const tagLine = input.tags?.length ? input.tags.join(", ") : "None";
  const previousSentence = input.previousSummarySentence?.trim();
  const previousLabel = input.previousSummaryLabel?.trim();

  const { prompt: systemPrompt, langfusePrompt } =
    await getMeetingSummarySystemPrompt();

  const userPrompt = [
    `Today is ${formatLongDate(now)}.`,
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
    const modelChoice = getModelChoice("meetingSummary");
    const openAIClient = createOpenAIClient({
      traceName: "meeting-summary",
      generationName: "meeting-summary",
      tags: ["feature:meeting_summary"],
      metadata: {
        serverName: input.serverName,
        channelName: input.channelName,
      },
      langfusePrompt,
      parentSpanContext: input.parentSpanContext,
    });
    const completion = await openAIClient.chat.completions.create({
      model: modelChoice.model,
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
