import { ChatInputCommandInteraction } from "discord.js";
import { getRecentMeetingsForGuild } from "../db";
import { config } from "../services/configService";
import OpenAI from "openai";
import { normalizeTags, parseTags } from "../utils/tags";

const openAIClient = new OpenAI({
  apiKey: config.openai.apiKey,
  organization: config.openai.organizationId,
  project: config.openai.projectId,
});

export async function handleAskCommand(
  interaction: ChatInputCommandInteraction,
) {
  const question = interaction.options.getString("question");
  const tagsInput = interaction.options.getString("tags");
  const scope = (interaction.options.getString("scope") || "guild") as
    | "guild"
    | "channel";

  if (!question) {
    await interaction.reply({
      content: "Please provide a question.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const answer = await answerQuestion({
      guildId: interaction.guildId!,
      channelId: interaction.channelId!,
      question,
      tags: normalizeTags(parseTags(tagsInput)),
      scope,
    });

    await interaction.editReply(answer);
  } catch (error) {
    console.error("Error handling /ask:", error);
    await interaction.editReply("Error answering that question.");
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

interface AnswerQuestionOpts {
  guildId: string;
  channelId: string;
  question: string;
  tags?: string[];
  scope?: "guild" | "channel";
}

export async function answerQuestion(
  opts: AnswerQuestionOpts,
): Promise<string> {
  const { guildId, channelId, question } = opts;
  const scope = opts.scope ?? "guild";
  const tags = opts.tags;

  const maxMeetings = config.ask.maxMeetings;
  let meetings = await getRecentMeetingsForGuild(guildId, maxMeetings);

  // Derive unique tag suggestions here if needed later (kept isolated for swap)
  if (tags?.length) {
    meetings = meetings.filter(
      (m) => m.tags && m.tags.some((t) => tags.includes(t)),
    );
  }

  if (scope === "channel") {
    meetings = meetings.filter((m) => m.channelId === channelId);
  }

  if (!meetings.length) {
    return "No relevant meetings found.";
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

  return completion.choices[0].message.content ?? "No answer.";
}
