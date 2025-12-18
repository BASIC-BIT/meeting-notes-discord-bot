import { MeetingData } from "../types/meeting-data";
import { getRecentMeetingsForGuild } from "../db";
import { config } from "./configService";
import { normalizeTags } from "../utils/tags";

type Line = { ts: number; speaker: string; text: string };
export type LatestUtterance = {
  speaker: string;
  text: string;
  timestamp: number;
};

function formatLine(line: Line): string {
  const time = new Date(line.ts).toISOString();
  return `${time} ${line.speaker}: ${line.text}`;
}

function collectWindowLines(meeting: MeetingData): Line[] {
  const now = Date.now();
  const maxAgeMs = config.liveVoice.windowSeconds * 1000;
  const maxLines = config.liveVoice.windowLines;

  const all = meeting.audioData.audioFiles
    .filter((f) => f.transcript && f.transcript.length > 0)
    .map((f) => ({
      ts: f.timestamp ?? now,
      speaker: getSpeakerLabel(meeting, f.userId),
      text: f.transcript!,
    }))
    .sort((a, b) => a.ts - b.ts);

  const recentByTime =
    maxAgeMs > 0 ? all.filter((l) => l.ts >= now - maxAgeMs) : all;
  const trimmed =
    maxLines > 0 ? recentByTime.slice(-maxLines) : recentByTime.slice();
  return trimmed;
}

function getSpeakerLabel(meeting: MeetingData, userId: string): string {
  const participant = meeting.participants.get(userId);
  if (!participant) return userId;
  return (
    participant.nickname || participant.globalName || participant.tag || userId
  );
}

export interface LiveResponderContext {
  userPrompt: string;
  debug: {
    windowLines: number;
    pastMeetings: Array<{ meetingId: string; timestamp: string }>;
  };
}

export async function buildLiveResponderContext(
  meeting: MeetingData,
  latest: LatestUtterance,
): Promise<LiveResponderContext> {
  const windowLines = collectWindowLines(meeting);

  // Past meetings: filter by tags if present, then by same channel, then recency
  const maxPast = config.liveVoice.pastMeetingsMax;
  let pastMeetings = await getRecentMeetingsForGuild(
    meeting.guildId,
    maxPast * 2, // overfetch a bit then trim
  );

  const meetingTags = normalizeTags(meeting.tags || []) ?? [];
  if (meetingTags.length) {
    pastMeetings = pastMeetings.filter(
      (m) => m.tags && m.tags.some((t) => meetingTags.includes(t)),
    );
  }
  if (meeting.channelId) {
    pastMeetings = pastMeetings.filter(
      (m) => m.channelId === meeting.channelId,
    );
  }
  pastMeetings = pastMeetings.slice(0, maxPast);

  const pastBlocks = pastMeetings.map((m) => {
    const date = new Date(m.timestamp).toLocaleDateString();
    const tagText = m.tags?.length ? `Tags: ${m.tags.join(", ")}` : "";
    const summary =
      (m.notes || m.transcript || "")
        .trim()
        .slice(0, config.liveVoice.pastMeetingsMaxChars) || "(no notes)";
    const sourceLink =
      m.notesChannelId && m.notesMessageIds?.length
        ? `https://discord.com/channels/${meeting.guildId}/${m.notesChannelId}/${m.notesMessageIds[0]}`
        : "n/a";
    return `- ${date} • ${m.meetingId}\n  ${tagText}\n  Summary: ${summary}\n  Source: ${sourceLink}`;
  });

  const windowBlock =
    windowLines.length > 0
      ? windowLines.map(formatLine).join("\n")
      : "(no recent transcript lines)";

  const pastBlock =
    pastBlocks.length > 0
      ? pastBlocks.join("\n\n")
      : "(no past meetings pulled into context)";

  const userPrompt = [
    `Latest line: ${formatLine({
      ts: latest.timestamp,
      speaker: latest.speaker,
      text: latest.text,
    })}`,
    "",
    `Recent live transcript (up to ${config.liveVoice.windowLines} lines / ${config.liveVoice.windowSeconds}s):`,
    windowBlock,
    "",
    "Past meetings (brief):",
    pastBlock,
    "",
    `Server: ${meeting.guild.name}`,
    `Channel: ${meeting.voiceChannel.name}`,
  ].join("\n");

  return {
    userPrompt,
    debug: {
      windowLines: windowLines.length,
      pastMeetings: pastMeetings.map((m) => ({
        meetingId: m.meetingId,
        timestamp: m.timestamp,
      })),
    },
  };
}
