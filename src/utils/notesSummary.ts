export function formatNotesWithSummary(
  notes: string,
  summarySentence?: string,
  summaryLabel?: string,
): string {
  const trimmedNotes = notes.trim();
  const lines: string[] = [];
  if (summaryLabel) {
    lines.push(`Label: ${summaryLabel}`);
  }
  if (summarySentence) {
    lines.push(`Summary: ${summarySentence}`);
  }
  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(trimmedNotes);
  return lines.join("\n");
}
