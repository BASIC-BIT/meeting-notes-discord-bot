import { listRecentMeetingsForGuildService } from "./meetingHistoryService";
import { config } from "./configService";
import { normalizeTags, parseTags } from "../utils/tags";
import { buildUpgradeTextOnly } from "../utils/upgradePrompt";
import { ensureUserCanViewChannel } from "./discordPermissionsService";
import { createOpenAIClient } from "./openaiClient";
import { getModelChoice } from "./modelFactory";
import { getLangfuseChatPrompt } from "./langfusePromptService";

export type AskScope = "guild" | "channel";

export type AskHistoryMessage = {
  role: "user" | "chronote";
  text: string;
};

export interface AskRequest {
  guildId: string;
  channelId: string;
  question: string;
  tags?: string[];
  scope?: AskScope;
  maxMeetings?: number;
  history?: AskHistoryMessage[];
  viewerUserId?: string;
}

export interface AskResponse {
  answer: string;
  sourceMeetingIds?: string[];
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

type MeetingSummary = Awaited<
  ReturnType<typeof listRecentMeetingsForGuildService>
>[number];

const scrubInternalIds = (text: string) =>
  text
    .replace(/\(id [0-9a-f-]{8,}\)/gi, "")
    .replace(/\bid [0-9a-f-]{8,}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const buildContextBlocks = (meetings: MeetingSummary[], guildId: string) =>
  meetings.map((m) => {
    const date = new Date(m.timestamp).toLocaleDateString();
    const tagText = m.tags?.length ? `Tags: ${m.tags.join(", ")}` : "";
    const notes = m.notes
      ? truncate(scrubInternalIds(m.notes), 900)
      : "(no notes)";
    const sourceLink =
      m.notesChannelId && m.notesMessageIds?.length
        ? `https://discord.com/channels/${guildId}/${m.notesChannelId}/${m.notesMessageIds[0]}`
        : "";
    const sourceLine = sourceLink ? `\n  Source: ${sourceLink}` : "";
    return `- Meeting ${date} ${tagText}\n  Notes: ${notes}${sourceLine}`;
  });

const filterMeetings = (
  meetings: MeetingSummary[],
  channelId: string,
  scope: AskScope,
  tags?: string[],
) => {
  let filtered = meetings;
  if (tags?.length) {
    filtered = filtered.filter(
      (m) => m.tags && m.tags.some((t) => tags.includes(t)),
    );
  }
  if (scope === "channel") {
    filtered = filtered.filter((m) => m.channelId === channelId);
  }
  return filtered;
};

const filterMeetingsByChannelAccess = async (
  meetings: MeetingSummary[],
  guildId: string,
  userId: string,
) => {
  const visible: MeetingSummary[] = [];
  for (const meeting of meetings) {
    const allowed = await ensureUserCanViewChannel({
      guildId,
      channelId: meeting.channelId,
      userId,
    });
    if (allowed) {
      visible.push(meeting);
    }
  }
  return visible;
};

const buildNoMeetingsResponse = (
  allMeetings: MeetingSummary[],
  maxMeetings: number,
): AskResponse => {
  if (!allMeetings.length) {
    return {
      answer:
        "I don't have any meetings yet. Start one with `/startmeeting` in Discord or enable auto-recording in Settings.",
      sourceMeetingIds: [],
    };
  }
  const note =
    maxMeetings < config.ask.maxMeetings
      ? buildUpgradeTextOnly(
          "No relevant meetings found. Upgrade for deeper history.",
        )
      : "No relevant meetings found.";
  return { answer: note, sourceMeetingIds: [] };
};

const buildMockResponse = (
  question: string,
  guildId: string,
  meetings: MeetingSummary[],
): AskResponse => {
  if (!meetings.length) {
    return {
      answer:
        "Mock mode: no meetings found yet. Start one with `/startmeeting` in Discord or enable auto-recording in Settings.",
      sourceMeetingIds: [],
    };
  }
  const sample = meetings[0];
  const sourceMeetingIds = meetings.map(
    (meeting) => meeting.channelId_timestamp,
  );
  const mockSourceLink =
    sample.notesChannelId && sample.notesMessageIds?.length
      ? `https://discord.com/channels/${guildId}/${sample.notesChannelId}/${sample.notesMessageIds[0]}`
      : "";
  const sourceLine = mockSourceLink ? `\n\nSource: ${mockSourceLink}` : "";
  return {
    answer: `Mock answer for "${question}".${sourceLine}`,
    sourceMeetingIds,
  };
};

export async function answerQuestionService(
  req: AskRequest,
): Promise<AskResponse> {
  const { guildId, channelId, question } = req;
  const scope = req.scope ?? "guild";
  const tags = req.tags
    ? normalizeTags(parseTags(req.tags.join(",")))
    : undefined;

  const maxMeetings = req.maxMeetings ?? config.ask.maxMeetings;
  const allMeetings = await listRecentMeetingsForGuildService(
    guildId,
    maxMeetings,
  );
  const scopedMeetings = filterMeetings(allMeetings, channelId, scope, tags);
  const meetings = req.viewerUserId
    ? await filterMeetingsByChannelAccess(
        scopedMeetings,
        guildId,
        req.viewerUserId,
      )
    : scopedMeetings;

  if (config.mock.enabled) {
    return buildMockResponse(question, guildId, meetings);
  }

  if (!meetings.length) {
    return buildNoMeetingsResponse(allMeetings, maxMeetings);
  }

  const sourceMeetingIds = meetings.map(
    (meeting) => meeting.channelId_timestamp,
  );
  const contextBlocks = buildContextBlocks(meetings, guildId);

  const history = (req.history ?? []).slice(-10);
  const historyBlock =
    history.length > 0
      ? history
          .map((msg) => {
            const label = msg.role === "chronote" ? "Chronote" : "User";
            return `${label}: ${msg.text}`;
          })
          .join("\n")
      : "None.";

  const { messages, langfusePrompt } = await getLangfuseChatPrompt({
    name: config.langfuse.askPromptName,
    variables: {
      question,
      contextBlocks: contextBlocks.join("\n"),
      historyBlock,
    },
  });

  const modelChoice = getModelChoice("ask");
  const openAIClient = createOpenAIClient({
    traceName: "ask",
    generationName: "ask",
    tags: ["feature:ask"],
    metadata: {
      guildId,
      channelId,
      scope,
    },
    langfusePrompt,
  });
  const completion = await openAIClient.chat.completions.create({
    model: modelChoice.model,
    messages,
    max_completion_tokens: 300,
  });

  return {
    answer: completion.choices[0].message.content ?? "No answer.",
    sourceMeetingIds,
  };
}
