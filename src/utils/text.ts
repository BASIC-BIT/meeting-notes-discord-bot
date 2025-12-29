/**
 * Remove leading/trailing Markdown code fences from a string.
 * Preserves inner content; noop if no wrapping fence.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const lines = trimmed.split("\n");
  // drop opening fence (may include language)
  lines.shift();
  // drop closing fence if present
  if (lines.length && lines[lines.length - 1].startsWith("```")) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

export function scrubForSpeech(text: string): string {
  const withoutMarkdownLinks = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi,
    "$1",
  );
  return withoutMarkdownLinks
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/<[@#][!&]?\d+>/g, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
