import { EmbedBuilder } from "discord.js";

const EMBED_DESCRIPTION_LIMIT = 4096;
const MAX_EMBEDS = 10;

function splitTextForEmbeds(
  text: string,
  limit: number = EMBED_DESCRIPTION_LIMIT,
): string[] {
  if (!text) {
    return [""];
  }

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitIndex = remaining.lastIndexOf("\n", limit);

    // If no newline found near the boundary, hard split at the limit
    if (splitIndex === -1 || splitIndex < limit * 0.5) {
      splitIndex = limit;
    }

    const part = remaining.slice(0, splitIndex);
    segments.push(part);
    remaining = remaining.slice(splitIndex);
    if (remaining.startsWith("\n")) {
      remaining = remaining.slice(1);
    }
  }

  if (remaining.length > 0 || segments.length === 0) {
    segments.push(remaining);
  }

  // Respect Discord's 10-embed limit
  if (segments.length > MAX_EMBEDS) {
    const keep = segments.slice(0, MAX_EMBEDS - 1);
    const remainder = segments.slice(MAX_EMBEDS - 1).join("\n");
    const trimmedRemainder =
      remainder.length > limit
        ? remainder.slice(0, limit - 20) + "\n...(truncated)"
        : remainder;
    keep.push(trimmedRemainder);
    return keep;
  }

  return segments;
}

interface BuildEmbedsOptions {
  text: string;
  baseTitle: string;
  footerText?: string;
  color?: number;
}

export function buildPaginatedEmbeds({
  text,
  baseTitle,
  footerText,
  color,
}: BuildEmbedsOptions): EmbedBuilder[] {
  const parts = splitTextForEmbeds(text);

  return parts.map((part, index) => {
    const embed = new EmbedBuilder()
      .setDescription(part || " ")
      .setTitle(
        parts.length > 1
          ? `${baseTitle} (part ${index + 1}/${parts.length})`
          : baseTitle,
      );

    if (footerText) {
      embed.setFooter({ text: footerText });
    }

    if (color) {
      embed.setColor(color);
    }

    return embed;
  });
}
