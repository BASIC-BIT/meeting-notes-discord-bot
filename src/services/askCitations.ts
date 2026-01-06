import type { MeetingHistory } from "../types/db";
import type { AskCitation, AskCitationTarget } from "../types/ask";

type CitationTag = {
  index: number;
  target: AskCitationTarget;
  eventId?: string;
};

const CITATION_TAG_REGEX = /<chronote:cite\b[^>]*?\/>/gi;
const MAX_CITATION_TAG_LENGTH = 512;
const ATTRIBUTE_KEYS = new Set([
  "index",
  "target",
  "eventId",
  "event",
  "lineId",
]);

const isCitationTarget = (value?: string): value is AskCitationTarget =>
  value === "portal" || value === "discord_summary" || value === "transcript";

const isWhitespace = (code: number) =>
  code === 9 || code === 10 || code === 13 || code === 32;

const isAttrKeyChar = (code: number) =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  code === 95;

const isTagClose = (raw: string, index: number) =>
  raw[index] === "/" && raw[index + 1] === ">";

const skipWhitespace = (raw: string, start: number) => {
  let i = start;
  while (i < raw.length && isWhitespace(raw.charCodeAt(i))) i += 1;
  return i;
};

const readAttrKey = (raw: string, start: number) => {
  let i = start;
  while (i < raw.length && isAttrKeyChar(raw.charCodeAt(i))) i += 1;
  if (i === start) return { key: undefined, next: start + 1 };
  return { key: raw.slice(start, i), next: i };
};

const skipToSeparator = (raw: string, start: number) => {
  let i = start;
  while (i < raw.length && !isWhitespace(raw.charCodeAt(i))) {
    if (isTagClose(raw, i)) break;
    i += 1;
  }
  return i;
};

const readQuotedValue = (raw: string, start: number) => {
  if (raw[start] !== '"') {
    return { value: undefined, next: skipToSeparator(raw, start) };
  }
  let i = start + 1;
  const valueStart = i;
  while (i < raw.length && raw[i] !== '"') i += 1;
  if (i >= raw.length) return { value: undefined, next: raw.length };
  return { value: raw.slice(valueStart, i), next: i + 1 };
};

const parseCitationAttributes = (raw: string) => {
  const attrs: Record<string, string> = {};
  if (raw.length > MAX_CITATION_TAG_LENGTH) return attrs;

  const len = raw.length;
  let i = raw.indexOf(" ");
  if (i === -1) return attrs;

  while (i < len) {
    i = skipWhitespace(raw, i);
    if (i >= len || isTagClose(raw, i)) break;

    const { key, next } = readAttrKey(raw, i);
    i = next;
    if (!key) continue;

    i = skipWhitespace(raw, i);
    if (raw[i] !== "=") {
      i = skipToSeparator(raw, i);
      continue;
    }

    i = skipWhitespace(raw, i + 1);
    const { value, next: valueNext } = readQuotedValue(raw, i);
    i = valueNext;
    if (!value) continue;

    if (ATTRIBUTE_KEYS.has(key)) {
      attrs[key] = value;
    }
  }

  return attrs;
};

const parseCitationTag = (raw: string): CitationTag | null => {
  const attrs = parseCitationAttributes(raw);

  const indexRaw = attrs.index;
  const targetRaw = attrs.target;
  const index = indexRaw ? Number.parseInt(indexRaw, 10) : NaN;
  if (!Number.isFinite(index) || index < 1) return null;
  if (!isCitationTarget(targetRaw)) return null;

  const eventId = attrs.eventId ?? attrs.event ?? attrs.lineId;
  return { index, target: targetRaw, eventId };
};

export const extractCitationTags = (text: string): CitationTag[] => {
  const tags: CitationTag[] = [];
  for (const match of text.matchAll(CITATION_TAG_REGEX)) {
    const parsed = parseCitationTag(match[0]);
    if (parsed) {
      tags.push(parsed);
    }
  }
  return tags;
};

export const stripCitationTags = (text: string) =>
  text
    .replace(CITATION_TAG_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trim();

export const buildAskCitations = (options: {
  text: string;
  meetings: MeetingHistory[];
}): AskCitation[] => {
  const tags = extractCitationTags(options.text);
  const citations: AskCitation[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const meeting = options.meetings[tag.index - 1];
    if (!meeting?.channelId_timestamp) continue;
    const key = `${tag.index}:${tag.target}:${tag.eventId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    citations.push({
      index: tag.index,
      target: tag.target,
      meetingId: meeting.channelId_timestamp,
      notesChannelId: meeting.notesChannelId,
      notesMessageId: meeting.notesMessageIds?.[0],
      eventId: tag.eventId,
    });
  }

  return citations;
};

const buildPortalUrl = (options: {
  baseUrl?: string;
  guildId: string;
  meetingId: string;
  eventId?: string;
}) => {
  const { baseUrl, guildId, meetingId, eventId } = options;
  const path = `/portal/server/${guildId}/library?meetingId=${encodeURIComponent(
    meetingId,
  )}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ""}`;
  if (!baseUrl) return path;
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path}`;
};

const buildDiscordSummaryUrl = (options: {
  guildId: string;
  notesChannelId?: string;
  notesMessageId?: string;
}) => {
  if (!options.notesChannelId || !options.notesMessageId) return undefined;
  return `https://discord.com/channels/${options.guildId}/${options.notesChannelId}/${options.notesMessageId}`;
};

const buildSourcesSection = (options: {
  citations: AskCitation[];
  guildId: string;
  portalBaseUrl?: string;
}) => {
  const groups = new Map<
    number,
    { index: number; links: Array<{ label: string; url: string }> }
  >();

  for (const citation of options.citations) {
    const entry = groups.get(citation.index) ?? {
      index: citation.index,
      links: [],
    };

    if (citation.target === "portal") {
      const url = buildPortalUrl({
        baseUrl: options.portalBaseUrl,
        guildId: options.guildId,
        meetingId: citation.meetingId,
        eventId: citation.eventId,
      });
      entry.links.push({ label: "Chronote", url });
    }

    if (citation.target === "discord_summary") {
      const url = buildDiscordSummaryUrl({
        guildId: options.guildId,
        notesChannelId: citation.notesChannelId,
        notesMessageId: citation.notesMessageId,
      });
      if (url) {
        entry.links.push({ label: "Discord summary", url });
      }
    }

    if (citation.target === "transcript" && citation.eventId) {
      const url = buildPortalUrl({
        baseUrl: options.portalBaseUrl,
        guildId: options.guildId,
        meetingId: citation.meetingId,
        eventId: citation.eventId,
      });
      entry.links.push({ label: "Transcript", url });
    }

    if (entry.links.length > 0) {
      groups.set(citation.index, entry);
    }
  }

  const sorted = Array.from(groups.values()).sort((a, b) => a.index - b.index);
  if (sorted.length === 0) return "";

  const lines = ["Sources:"];
  for (const group of sorted) {
    const links = group.links
      .map((link) => `[${link.label}](${link.url})`)
      .join(" ");
    lines.push(`- [${group.index}] Meeting ${group.index}: ${links}`);
  }
  return lines.join("\n");
};

export const renderAskAnswer = (options: {
  text: string;
  citations: AskCitation[];
  guildId: string;
  portalBaseUrl?: string;
  includeSources?: boolean;
}) => {
  const includeSources = options.includeSources ?? true;
  const rendered = options.text.replace(CITATION_TAG_REGEX, (match) => {
    const parsed = parseCitationTag(match);
    if (!parsed) return "";
    return `[${parsed.index}]`;
  });
  const sources = includeSources
    ? buildSourcesSection({
        citations: options.citations,
        guildId: options.guildId,
        portalBaseUrl: options.portalBaseUrl,
      })
    : "";
  if (!sources) return rendered.trim();
  return `${rendered.trim()}\n\n${sources}`;
};
