import { format } from "date-fns";
import type { MeetingEvent } from "../../types/meetingTimeline";
import {
  MEETING_STATUS,
  type MeetingStatus,
} from "../../types/meetingLifecycle";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const SUMMARY_CUTOFF = 180;
const TITLE_SKIP = new Set([
  "highlights",
  "decisions",
  "action items",
  "actions",
  "recap",
  "summary",
]);

export type MeetingDetails = {
  id: string;
  meetingId: string;
  title: string;
  summary: string;
  summaryLabel?: string;
  notes: string;
  dateLabel: string;
  durationLabel: string;
  tags: string[];
  channel: string;
  audioUrl?: string | null;
  attendees: string[];
  decisions: string[];
  actions: string[];
  events: MeetingEvent[];
  status?: MeetingStatus;
};

export type MeetingDetailInput = {
  id: string;
  meetingId: string;
  channelId: string;
  timestamp: string;
  duration: number;
  tags?: string[];
  notes?: string | null;
  summarySentence?: string | null;
  summaryLabel?: string | null;
  audioUrl?: string | null;
  attendees?: string[];
  events?: MeetingEvent[];
  status?: MeetingStatus;
};

export type MeetingFilterItem = {
  title: string;
  summary: string;
  tags: string[];
  channelId: string;
  timestamp: string;
};

export type MeetingFilterOptions = {
  query: string;
  selectedTags: string[];
  selectedChannel: string | null;
  selectedRange: string;
  nowMs?: number;
};

export const formatChannelLabel = (name?: string, fallback?: string) => {
  const raw = name ?? fallback ?? "Unknown channel";
  return raw.startsWith("#") ? raw : `#${raw}`;
};

export const formatDurationLabel = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
};

export const formatDateLabel = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return format(date, "MMM d, yyyy");
};

export const formatDateTimeLabel = (timestamp: string | Date) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return format(date, "PPpp");
};

export const normalizeNotes = (notes: string) =>
  notes.replace(/\r/g, "").trim();

const stripLinePrefix = (line: string) =>
  line
    .replace(/^[-*#\s]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();

const normalizeHeadingToken = (line: string) =>
  stripLinePrefix(line)
    .replace(/[:\s-]+$/, "")
    .toLowerCase();

export const deriveTitle = (notes: string, channelLabel: string) => {
  const lines = normalizeNotes(notes)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.find(
    (line) => !TITLE_SKIP.has(normalizeHeadingToken(line)),
  );
  if (candidate) {
    return stripLinePrefix(candidate);
  }
  return `Meeting in ${channelLabel.replace(/^#/, "")}`;
};

export const deriveSummary = (
  notes: string,
  summarySentence?: string | null,
) => {
  if (summarySentence && summarySentence.trim().length > 0) {
    return summarySentence.trim();
  }
  const normalized = normalizeNotes(notes);
  if (!normalized) {
    return "Notes will appear after the meeting is processed.";
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summaryLine = lines.find((line) =>
    stripLinePrefix(line).toLowerCase().includes("summary"),
  );
  if (summaryLine) {
    return stripLinePrefix(summaryLine).replace(/^summary[:\s-]*/i, "");
  }
  const singleLine = lines.join(" ").replace(/\s+/g, " ");
  if (singleLine.length <= SUMMARY_CUTOFF) {
    return singleLine;
  }
  return `${singleLine.slice(0, SUMMARY_CUTOFF)}...`;
};

const normalizeQuery = (query: string) => query.trim().toLowerCase();

const parseRangeDays = (value: string) => {
  if (!value || value === "all") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const matchesQuery = (item: MeetingFilterItem, needle: string) => {
  if (!needle) return true;
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return text.includes(needle);
};

const matchesTags = (item: MeetingFilterItem, selectedTags: string[]) => {
  if (selectedTags.length === 0) return true;
  return selectedTags.every((tag) => item.tags.includes(tag));
};

const matchesChannel = (item: MeetingFilterItem, channelId: string | null) => {
  if (!channelId) return true;
  return item.channelId === channelId;
};

const matchesRange = (
  item: MeetingFilterItem,
  rangeDays: number | null,
  nowMs: number,
) => {
  if (!rangeDays) return true;
  const ts = Date.parse(item.timestamp);
  if (!Number.isFinite(ts)) return true;
  const diffDays = (nowMs - ts) / MS_PER_DAY;
  return diffDays <= rangeDays;
};

export const filterMeetingItems = <T extends MeetingFilterItem>(
  meetingItems: T[],
  options: MeetingFilterOptions,
) => {
  const needle = normalizeQuery(options.query);
  const rangeDays = parseRangeDays(options.selectedRange);
  const nowMs = options.nowMs ?? Date.now();

  return meetingItems.filter(
    (item) =>
      matchesQuery(item, needle) &&
      matchesTags(item, options.selectedTags) &&
      matchesChannel(item, options.selectedChannel) &&
      matchesRange(item, rangeDays, nowMs),
  );
};

const resolveSummaryLabel = (value?: string | null) => value ?? undefined;

const resolveNotes = (notes?: string | null) =>
  notes && notes.trim().length > 0 ? notes : "No notes recorded.";

const resolveTags = (tags?: string[]) => tags ?? [];

const resolveAttendees = (attendees?: string[]) =>
  attendees && attendees.length > 0 ? attendees : ["Unknown"];

const resolveEvents = (events?: MeetingEvent[]) => events ?? [];

const resolveStatus = (status?: MeetingDetails["status"]) =>
  status ?? MEETING_STATUS.COMPLETE;

export const buildMeetingDetails = (
  detail: MeetingDetailInput,
  channelNameMap: Map<string, string>,
): MeetingDetails => {
  const channelLabel = formatChannelLabel(
    channelNameMap.get(detail.channelId),
    detail.channelId,
  );
  const rawNotes = detail.notes ?? "";

  return {
    id: detail.id,
    meetingId: detail.meetingId,
    title: deriveTitle(rawNotes, channelLabel),
    summary: deriveSummary(rawNotes, detail.summarySentence),
    summaryLabel: resolveSummaryLabel(detail.summaryLabel),
    notes: resolveNotes(detail.notes),
    dateLabel: formatDateLabel(detail.timestamp),
    durationLabel: formatDurationLabel(detail.duration),
    tags: resolveTags(detail.tags),
    channel: channelLabel,
    audioUrl: detail.audioUrl ?? null,
    attendees: resolveAttendees(detail.attendees),
    decisions: [],
    actions: [],
    events: resolveEvents(detail.events),
    status: resolveStatus(detail.status),
  };
};
