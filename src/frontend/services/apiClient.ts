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

const resolveViteEnv = (): { VITE_API_BASE_URL?: string } | undefined => {
  try {
    // Avoid direct import.meta usage to keep Jest/CommonJS happy.
    // eslint-disable-next-line no-new-func
    return new Function(
      "return typeof import.meta !== 'undefined' ? import.meta.env : undefined",
    )();
  } catch {
    return undefined;
  }
};

const runtimeApiBase =
  (typeof window !== "undefined" &&
    typeof window.__API_BASE_URL__ === "string" &&
    window.__API_BASE_URL__) ||
  resolveViteEnv()?.VITE_API_BASE_URL ||
  (typeof process !== "undefined" ? process.env.VITE_API_BASE_URL : undefined);

const rawBase = (runtimeApiBase || "").replace(/\/$/, "");
export const API_BASE =
  rawBase && !/^https?:\/\//i.test(rawBase) ? `http://${rawBase}` : rawBase;

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
