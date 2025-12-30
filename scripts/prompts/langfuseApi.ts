import "dotenv/config";
import { Buffer } from "node:buffer";

export type PromptType = "text" | "chat";

export type ChatMessage = {
  role: string;
  content: string;
};

export type LangfusePrompt = {
  name: string;
  type: PromptType;
  prompt: string | ChatMessage[];
  config: unknown;
  labels: string[];
  tags: string[];
  version?: number;
  commitMessage?: string | null;
};

export type PromptMeta = {
  name: string;
  type: PromptType;
  versions: number[];
  labels: string[];
  tags: string[];
  lastUpdatedAt: string;
  lastConfig: unknown;
};

export type PromptMetaListResponse = {
  data: PromptMeta[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
};

function getBaseUrl(): string {
  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();
  return baseUrl && baseUrl.length > 0 ? baseUrl : "https://cloud.langfuse.com";
}

function getAuthHeader(): string {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    throw new Error(
      "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required.",
    );
  }
  const token = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  return `Basic ${token}`;
}

async function requestJson<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Langfuse API error ${response.status} ${response.statusText}: ${text}`,
    );
  }

  return (await response.json()) as T;
}

export async function listPrompts(options: {
  name?: string;
  label?: string;
  tag?: string;
  page?: number;
  limit?: number;
  fromUpdatedAt?: string;
  toUpdatedAt?: string;
}): Promise<PromptMetaListResponse> {
  const params = new URLSearchParams();
  if (options.name) params.set("name", options.name);
  if (options.label) params.set("label", options.label);
  if (options.tag) params.set("tag", options.tag);
  if (options.page) params.set("page", String(options.page));
  if (options.limit) params.set("limit", String(options.limit));
  if (options.fromUpdatedAt) {
    params.set("fromUpdatedAt", options.fromUpdatedAt);
  }
  if (options.toUpdatedAt) {
    params.set("toUpdatedAt", options.toUpdatedAt);
  }

  const query = params.toString();
  const path = query
    ? `/api/public/v2/prompts?${query}`
    : "/api/public/v2/prompts";
  return requestJson<PromptMetaListResponse>("GET", path);
}

export async function getPrompt(options: {
  name: string;
  label?: string;
  version?: number;
}): Promise<LangfusePrompt> {
  const params = new URLSearchParams();
  if (options.label) params.set("label", options.label);
  if (options.version != null) params.set("version", String(options.version));

  const encodedName = encodeURIComponent(options.name);
  const query = params.toString();
  const path = query
    ? `/api/public/v2/prompts/${encodedName}?${query}`
    : `/api/public/v2/prompts/${encodedName}`;
  return requestJson<LangfusePrompt>("GET", path);
}

export async function createPrompt(
  payload: Omit<LangfusePrompt, "version">,
): Promise<LangfusePrompt> {
  return requestJson<LangfusePrompt>("POST", "/api/public/v2/prompts", payload);
}
