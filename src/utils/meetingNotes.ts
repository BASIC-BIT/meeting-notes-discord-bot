import { buildPaginatedEmbeds } from "./embedPagination";

const DEFAULT_NOTES_EMBED_TITLE = "Meeting Notes";

export function resolveNotesEmbedBaseTitle(
  meetingName?: string | null,
): string {
  const trimmed = meetingName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_NOTES_EMBED_TITLE;
}

export function formatNotesEmbedTitle(
  baseTitle: string,
  index: number,
  total: number,
): string {
  if (total > 1) {
    return `${baseTitle} (part ${index + 1}/${total})`;
  }
  return baseTitle;
}

export function buildMeetingNotesEmbeds(params: {
  notesBody: string;
  meetingName?: string | null;
  footerText?: string;
  color?: number;
}) {
  const baseTitle = resolveNotesEmbedBaseTitle(params.meetingName);
  return buildPaginatedEmbeds({
    text: params.notesBody,
    baseTitle,
    footerText: params.footerText,
    color: params.color,
  });
}
