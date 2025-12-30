import { MeetingData } from "../types/meeting-data";
import { listRecentMeetingsForGuildService } from "./meetingHistoryService";
import { config } from "./configService";
import { normalizeTags } from "../utils/tags";
import { formatParticipantLabel } from "../utils/participants";
import { formatLongDate, toIsoString } from "../utils/time";

type Line = { ts: number; speaker: string; text: string };
export type LatestUtterance = {
  speaker: string;
  text: string;
  timestamp: number;
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

function formatLine(line: Line): string {
  const time = toIsoString(line.ts);
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
  return formatParticipantLabel(participant, {
    includeUsername: false,
    fallbackName: userId,
  });
}

export type LiveResponderVariables = {
  latestLine: string;
  recentTranscript: string;
  pastMeetings: string;
  serverName: string;
  channelName: string;
  windowLines: number;
  windowSeconds: number;
};

export interface LiveResponderContext {
  variables: LiveResponderVariables;
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
  let pastMeetings = await listRecentMeetingsForGuildService(
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
    const date = formatLongDate(m.timestamp);
    const tagText = m.tags?.length ? `Tags: ${m.tags.join(", ")}` : "";
    const summary =
      m.summarySentence?.trim() ||
      truncate((m.notes || "").trim(), config.liveVoice.pastMeetingsMaxChars) ||
      "(no notes)";
    const label = m.summaryLabel?.trim();
    const tagLine = tagText ? `  ${tagText}\n` : "";
    const labelLine = label ? `  Label: ${label}\n` : "";
    return `- Meeting ${date}\n${tagLine}${labelLine}  Summary: ${summary}`;
  });

  const windowBlock =
    windowLines.length > 0
      ? windowLines.map(formatLine).join("\n")
      : "(no recent transcript lines)";

  const pastBlock =
    pastBlocks.length > 0
      ? pastBlocks.join("\n\n")
      : "(no past meetings pulled into context)";

  return {
    variables: {
      latestLine: formatLine({
        ts: latest.timestamp,
        speaker: latest.speaker,
        text: latest.text,
      }),
      recentTranscript: windowBlock,
      pastMeetings: pastBlock,
      serverName: meeting.guild.name,
      channelName: meeting.voiceChannel.name,
      windowLines: config.liveVoice.windowLines,
      windowSeconds: config.liveVoice.windowSeconds,
    },
    debug: {
      windowLines: windowLines.length,
      pastMeetings: pastMeetings.map((m) => ({
        meetingId: m.meetingId,
        timestamp: m.timestamp,
      })),
    },
  };
}
