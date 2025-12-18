import OpenAI from "openai";
import { getRecentMeetingsForGuild } from "../db";
import { config } from "./configService";
import { normalizeTags, parseTags } from "../utils/tags";
import { buildUpgradeTextOnly } from "../utils/upgradePrompt";

const openAIClient = new OpenAI({
  apiKey: config.openai.apiKey,
  organization: config.openai.organizationId,
  project: config.openai.projectId,
});

export type AskScope = "guild" | "channel";

export interface AskRequest {
  guildId: string;
  channelId: string;
  question: string;
  tags?: string[];
  scope?: AskScope;
  maxMeetings?: number;
}

export interface AskResponse {
  answer: string;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export async function answerQuestionService(
  req: AskRequest,
): Promise<AskResponse> {
  const { guildId, channelId, question } = req;
  const scope = req.scope ?? "guild";
  const tags = req.tags
    ? normalizeTags(parseTags(req.tags.join(",")))
    : undefined;

  const maxMeetings = req.maxMeetings ?? config.ask.maxMeetings;
  let meetings = await getRecentMeetingsForGuild(guildId, maxMeetings);

  if (tags?.length) {
    meetings = meetings.filter(
      (m) => m.tags && m.tags.some((t) => tags.includes(t)),
    );
  }

  if (scope === "channel") {
    meetings = meetings.filter((m) => m.channelId === channelId);
  }

  if (!meetings.length) {
    const note =
      maxMeetings < config.ask.maxMeetings
        ? buildUpgradeTextOnly(
            "No relevant meetings found. Upgrade for deeper history.",
          )
        : "No relevant meetings found.";
    return { answer: note };
  }

  const contextBlocks = meetings.map((m) => {
    const date = new Date(m.timestamp).toLocaleDateString();
    const tagText = m.tags?.length ? `Tags: ${m.tags.join(", ")}` : "";
    const notes = m.notes ? truncate(m.notes, 900) : "(no notes)";
    const sourceLink =
      m.notesChannelId && m.notesMessageIds?.length
        ? `https://discord.com/channels/${guildId}/${m.notesChannelId}/${m.notesMessageIds[0]}`
        : "n/a";
    return `- Meeting ${date} (id ${m.meetingId}) ${tagText}\n  Notes: ${notes}\n  Source: ${sourceLink}`;
  });

  const system =
    "You are Meeting Notes Bot. Answer the user's question using only the provided meeting summaries/notes. " +
    "Cite the meeting id and source link(s) from the context. If uncertain, say so.";

  const completion = await openAIClient.chat.completions.create({
    model: config.liveVoice.responderModel,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `Question: ${question}\n\nContext:\n${contextBlocks.join("\n")}`,
      },
    ],
    max_completion_tokens: 300,
  });

  return { answer: completion.choices[0].message.content ?? "No answer." };
}
