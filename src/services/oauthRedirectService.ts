export const buildAllowedRedirectOrigins = (
  siteUrl: string,
  allowedOrigins: string[],
): Set<string> => {
  const origins = new Set<string>();
  const candidates = [siteUrl, ...allowedOrigins]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const candidate of candidates) {
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Ignore invalid origin values.
    }
  }

  return origins;
};

export const resolveSafeRedirect = (
  rawRedirect: unknown,
  allowedOrigins: Set<string>,
): string | undefined => {
  if (typeof rawRedirect !== "string") return undefined;
  const trimmed = rawRedirect.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (allowedOrigins.has(url.origin)) {
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
};
