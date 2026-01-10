import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type {
  LlmAdapter,
  LlmConnection,
  UpsertLlmConnectionRequest,
} from "@langfuse/core";

export type LlmConnectionFile = {
  provider: string;
  adapter: LlmAdapter | string;
  secretKey?: string;
  secretKeyEnv?: string;
  baseUrl?: string;
  baseURL?: string;
  customModels?: string[];
  withDefaultModels?: boolean;
  extraHeaders?: Record<string, string>;
  extraHeadersEnv?: Record<string, string>;
  config?: Record<string, unknown> | null;
  environments?: string[];
};

export type LlmConnectionResolved = {
  provider: string;
  adapter: LlmAdapter;
  baseURL?: string;
  customModels: string[];
  withDefaultModels: boolean;
  extraHeaders: Record<string, string>;
  extraHeaderKeys: string[];
  config?: Record<string, unknown>;
  secretKey?: string;
};

const DEFAULT_WITH_DEFAULT_MODELS = true;
const VALID_ADAPTERS: Set<string> = new Set([
  "anthropic",
  "openai",
  "azure",
  "bedrock",
  "google-vertex-ai",
  "google-ai-studio",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string") as string[];
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, string>>(
    (acc, [key, val]) => {
      if (typeof val === "string") {
        acc[key] = val;
      }
      return acc;
    },
    {},
  );
}

function normalizeConfig(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return value;
}

function normalizeBaseUrl(file: LlmConnectionFile): string | undefined {
  const raw =
    typeof file.baseUrl === "string"
      ? file.baseUrl
      : typeof file.baseURL === "string"
        ? file.baseURL
        : undefined;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeEnvSuffix(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildSecretEnvName(provider: string): string {
  const suffix = sanitizeEnvSuffix(provider);
  return `LANGFUSE_LLM_SECRET_${suffix || "PROVIDER"}`;
}

function buildHeaderEnvName(provider: string, header: string): string {
  const providerSuffix = sanitizeEnvSuffix(provider);
  const headerSuffix = sanitizeEnvSuffix(header);
  return `LANGFUSE_LLM_HEADER_${providerSuffix || "PROVIDER"}_${headerSuffix || "HEADER"}`;
}

function resolveAdapter(adapter: string): LlmAdapter {
  if (!VALID_ADAPTERS.has(adapter)) {
    throw new Error(`Unsupported LLM adapter "${adapter}".`);
  }
  return adapter as LlmAdapter;
}

function resolveSecretKey(
  file: LlmConnectionFile,
  requireSecret: boolean,
): string | undefined {
  if (typeof file.secretKey === "string" && file.secretKey.trim().length > 0) {
    return file.secretKey;
  }
  if (
    typeof file.secretKeyEnv === "string" &&
    file.secretKeyEnv.trim().length > 0
  ) {
    const value = process.env[file.secretKeyEnv.trim()];
    if (!value) {
      if (requireSecret) {
        throw new Error(
          `Missing secret key env var "${file.secretKeyEnv}" for ${file.provider}.`,
        );
      }
      return undefined;
    }
    return value;
  }
  if (requireSecret) {
    throw new Error(`Missing secret key for ${file.provider}.`);
  }
  return undefined;
}

function resolveExtraHeaders(
  file: LlmConnectionFile,
  requireValues: boolean,
): Record<string, string> {
  const extraHeaders = normalizeStringRecord(file.extraHeaders);
  const extraHeadersEnv = normalizeStringRecord(file.extraHeadersEnv);

  const resolved: Record<string, string> = { ...extraHeaders };
  for (const [header, envKey] of Object.entries(extraHeadersEnv)) {
    const trimmedEnv = envKey.trim();
    if (!trimmedEnv) {
      if (requireValues) {
        throw new Error(
          `Missing env var name for header "${header}" in ${file.provider}.`,
        );
      }
      continue;
    }
    const value = process.env[trimmedEnv];
    if (!value) {
      if (requireValues) {
        throw new Error(
          `Missing env var "${trimmedEnv}" for header "${header}" in ${file.provider}.`,
        );
      }
      continue;
    }
    resolved[header] = value;
  }
  return resolved;
}

function resolveExtraHeaderKeys(file: LlmConnectionFile): string[] {
  const extraHeaders = normalizeStringRecord(file.extraHeaders);
  const extraHeadersEnv = normalizeStringRecord(file.extraHeadersEnv);
  return Array.from(
    new Set([...Object.keys(extraHeaders), ...Object.keys(extraHeadersEnv)]),
  ).sort();
}

function resolveEnvironments(value: unknown): string[] {
  return normalizeStringArray(value)
    .map((env) => env.trim())
    .filter(Boolean);
}

function matchesEnvironment(file: LlmConnectionFile, filter?: string): boolean {
  if (!filter) return true;
  const envs = resolveEnvironments(file.environments);
  if (envs.length === 0) return true;
  return envs.includes(filter);
}

export async function listConnectionFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listConnectionFiles(entryPath)));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
      ) {
        files.push(entryPath);
      }
    }
    return files.sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT") {
        return [];
      }
    }
    throw error;
  }
}

export async function readConnectionFile(
  filePath: string,
): Promise<LlmConnectionFile> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`Invalid LLM connection file: ${filePath}`);
  }
  const provider =
    typeof parsed.provider === "string" ? parsed.provider.trim() : "";
  if (!provider) {
    throw new Error(`Missing provider in ${filePath}.`);
  }
  const adapter =
    typeof parsed.adapter === "string" ? parsed.adapter.trim() : "";
  if (!adapter) {
    throw new Error(`Missing adapter in ${filePath}.`);
  }

  return {
    provider,
    adapter,
    secretKey:
      typeof parsed.secretKey === "string" ? parsed.secretKey : undefined,
    secretKeyEnv:
      typeof parsed.secretKeyEnv === "string" ? parsed.secretKeyEnv : undefined,
    baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
    baseURL: typeof parsed.baseURL === "string" ? parsed.baseURL : undefined,
    customModels: normalizeStringArray(parsed.customModels),
    withDefaultModels:
      typeof parsed.withDefaultModels === "boolean"
        ? parsed.withDefaultModels
        : undefined,
    extraHeaders: normalizeStringRecord(parsed.extraHeaders),
    extraHeadersEnv: normalizeStringRecord(parsed.extraHeadersEnv),
    config: normalizeConfig(parsed.config) ?? undefined,
    environments: resolveEnvironments(parsed.environments),
  };
}

export function resolveConnectionForCheck(
  file: LlmConnectionFile,
  envFilter?: string,
): LlmConnectionResolved | null {
  if (!matchesEnvironment(file, envFilter)) {
    return null;
  }
  return {
    provider: file.provider,
    adapter: resolveAdapter(String(file.adapter)),
    baseURL: normalizeBaseUrl(file),
    customModels: normalizeStringArray(file.customModels),
    withDefaultModels:
      typeof file.withDefaultModels === "boolean"
        ? file.withDefaultModels
        : DEFAULT_WITH_DEFAULT_MODELS,
    extraHeaders: {},
    extraHeaderKeys: resolveExtraHeaderKeys(file),
    config: normalizeConfig(file.config),
  };
}

export function resolveConnectionForPush(
  file: LlmConnectionFile,
  envFilter?: string,
): UpsertLlmConnectionRequest | null {
  if (!matchesEnvironment(file, envFilter)) {
    return null;
  }

  const secretKey = resolveSecretKey(file, true);
  const extraHeaders = resolveExtraHeaders(file, true);

  return {
    provider: file.provider,
    adapter: resolveAdapter(String(file.adapter)),
    secretKey: secretKey ?? "",
    baseURL: normalizeBaseUrl(file),
    customModels: normalizeStringArray(file.customModels),
    withDefaultModels:
      typeof file.withDefaultModels === "boolean"
        ? file.withDefaultModels
        : DEFAULT_WITH_DEFAULT_MODELS,
    extraHeaders:
      Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    config: normalizeConfig(file.config),
  };
}

export function buildConnectionPath(dir: string, provider: string): string {
  const safe = provider.replace(/[^\w.-]+/g, "-");
  return path.join(dir, `${safe}.yml`);
}

export async function collectExistingConnectionExtras(
  dir: string,
): Promise<
  Map<
    string,
    Pick<
      LlmConnectionFile,
      | "secretKey"
      | "secretKeyEnv"
      | "extraHeaders"
      | "extraHeadersEnv"
      | "environments"
    >
  >
> {
  const extras = new Map<
    string,
    Pick<
      LlmConnectionFile,
      | "secretKey"
      | "secretKeyEnv"
      | "extraHeaders"
      | "extraHeadersEnv"
      | "environments"
    >
  >();
  const files = await listConnectionFiles(dir);
  for (const filePath of files) {
    try {
      const file = await readConnectionFile(filePath);
      extras.set(file.provider, {
        secretKey: file.secretKey,
        secretKeyEnv: file.secretKeyEnv,
        extraHeaders: file.extraHeaders,
        extraHeadersEnv: file.extraHeadersEnv,
        environments: file.environments,
      });
    } catch {
      console.warn(`Skipping ${filePath}, unable to parse.`);
    }
  }
  return extras;
}

export function formatConnectionFile(options: {
  connection: LlmConnection;
  existing?: Pick<
    LlmConnectionFile,
    | "secretKey"
    | "secretKeyEnv"
    | "extraHeaders"
    | "extraHeadersEnv"
    | "environments"
  >;
}): string {
  const { connection, existing } = options;
  const provider = connection.provider;
  const secretKeyEnv = existing?.secretKeyEnv || buildSecretEnvName(provider);

  const extraHeadersEnv =
    existing?.extraHeadersEnv ??
    connection.extraHeaderKeys.reduce<Record<string, string>>((acc, key) => {
      acc[key] = buildHeaderEnvName(provider, key);
      return acc;
    }, {});

  const extraHeaders = existing?.extraHeaders ?? {};

  const file: Record<string, unknown> = {
    provider: connection.provider,
    adapter: connection.adapter,
    secretKey: existing?.secretKey,
    secretKeyEnv: existing?.secretKey ? undefined : secretKeyEnv,
    baseUrl: connection.baseURL,
    withDefaultModels: connection.withDefaultModels,
    customModels: connection.customModels ?? [],
    extraHeaders:
      Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    extraHeadersEnv:
      Object.keys(extraHeadersEnv).length > 0 ? extraHeadersEnv : undefined,
    config: normalizeConfig(connection.config),
    environments: existing?.environments,
  };

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(file)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isRecord(value) && Object.keys(value).length === 0) continue;
    cleaned[key] = value;
  }

  return stringify(cleaned).trimEnd() + "\n";
}

export function normalizeRemoteConnection(
  connection: LlmConnection,
): LlmConnectionResolved {
  return {
    provider: connection.provider,
    adapter: resolveAdapter(connection.adapter),
    baseURL: connection.baseURL?.trim() || undefined,
    customModels: [...(connection.customModels ?? [])].sort(),
    withDefaultModels:
      typeof connection.withDefaultModels === "boolean"
        ? connection.withDefaultModels
        : DEFAULT_WITH_DEFAULT_MODELS,
    extraHeaders: {},
    extraHeaderKeys: [...(connection.extraHeaderKeys ?? [])].sort(),
    config: normalizeConfig(connection.config),
  };
}

export function compareStringArrays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
