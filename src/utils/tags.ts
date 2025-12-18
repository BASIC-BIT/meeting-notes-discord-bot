export function parseTags(input?: string | null): string[] | undefined {
  if (!input) return undefined;
  const tags = input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length ? tags : undefined;
}

export function normalizeTags(tags?: string[] | null): string[] | undefined {
  if (!tags) return undefined;
  const cleaned = tags
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t);
  return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
}

// Build a simple frequency map and return the top N tags (most used first).
/**
 * Return the top tags with a simple recency weight.
 * More recent meetings contribute higher weight (linear decay by index).
 */
export function topTags(
  meetings: { tags?: string[] }[],
  max: number = 10,
): string[] {
  const freq = new Map<string, number>();
  const total = meetings.length || 1;

  meetings.forEach((m, idx) => {
    if (!m.tags) return;
    // Recent meetings (lower idx) get higher weight; at least weight 1
    const weight = Math.max(1, total - idx);
    for (const t of m.tags) {
      const tag = t.trim();
      if (!tag) continue;
      freq.set(tag, (freq.get(tag) ?? 0) + weight);
    }
  });

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}
