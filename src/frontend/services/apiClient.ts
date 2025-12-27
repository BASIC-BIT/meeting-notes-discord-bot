export class AuthNeededError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthNeededError";
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseJsonSafely(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthNeededError("Non-JSON response (likely auth redirect)");
  }
}

declare global {
  interface Window {
    __API_BASE_URL__?: string;
  }
}

function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Assume localhost is plain HTTP for local dev.
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Default to HTTPS for everything else (avoids mixed-content on HTTPS sites).
  return `https://${trimmed}`;
}

type ApiBaseGlobal = { __API_BASE_URL__?: string };

const apiBaseFromGlobal =
  typeof globalThis !== "undefined" &&
  typeof (globalThis as ApiBaseGlobal).__API_BASE_URL__ === "string"
    ? (globalThis as ApiBaseGlobal).__API_BASE_URL__
    : undefined;

const runtimeApiBase =
  apiBaseFromGlobal ||
  (typeof process !== "undefined" ? process.env.VITE_API_BASE_URL : undefined);

export const API_BASE = normalizeApiBase(runtimeApiBase || "");

export function buildApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return normalized;
  return `${API_BASE.replace(/\/$/, "")}${normalized}`;
}

function withBase(input: RequestInfo): RequestInfo {
  if (typeof input !== "string") return input;
  if (!API_BASE || input.startsWith("http")) return input;
  // ensure single slash
  return `${API_BASE.replace(/\/$/, "")}${input.startsWith("/") ? "" : "/"}${input}`;
}

export async function apiFetch<T = unknown>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(withBase(input), {
    credentials: "include",
    ...init,
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthNeededError();
  }

  if (!res.ok) {
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }

  const data = await parseJsonSafely(res);
  return data as T;
}
