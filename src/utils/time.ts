const DEFAULT_LONG_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIsoString(value: string | number | Date): string {
  return new Date(value).toISOString();
}

export function toTimestampMs(
  value: string | number | Date,
  fallbackMs = 0,
): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

export function formatElapsedSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      secs,
    ).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatLongDate(
  value: string | number | Date,
  fallback = "Unknown date",
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", DEFAULT_LONG_DATE_OPTIONS);
}
