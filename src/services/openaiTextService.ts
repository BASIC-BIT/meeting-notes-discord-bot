import type OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type { OpenAITextApi } from "../config/openaiText";
import type { SavedRecordingSettings } from "../types/recordingContent";
import type { ChatMessage } from "./langfusePromptService";
import { config } from "./configService";
import { createOpenAIClient } from "./openaiClient";

export type OpenAITextFormat =
  | { kind: "text" }
  | { kind: "json_object" }
  | { kind: "json_schema"; name: string; schema: Record<string, unknown> };

type TextGenerationOptions = {
  model: string;
  messages: readonly ChatMessage[];
  modelParams: SavedRecordingSettings["models"]["notes"]["params"];
  api?: OpenAITextApi;
  format?: OpenAITextFormat;
  maxOutputTokens?: number;
  continuation?: { maxRequests: number };
  signal?: AbortSignal;
  safetyIdentifier?: string;
  tracing?: NonNullable<Parameters<typeof createOpenAIClient>[0]>;
};

type TextRequest = TextGenerationOptions & {
  api: OpenAITextApi;
  format: OpenAITextFormat;
  client: OpenAI;
};

function chatFormat(
  format: OpenAITextFormat,
): ChatCompletionCreateParamsNonStreaming["response_format"] {
  if (format.kind === "text") return undefined;
  if (format.kind === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: { name: format.name, schema: format.schema, strict: true },
  };
}

function responseText(
  request: TextRequest,
): ResponseCreateParamsNonStreaming["text"] {
  const format = request.format;
  const verbosity = request.modelParams.verbosity;
  if (format.kind === "text") return verbosity ? { verbosity } : undefined;
  const outputFormat =
    format.kind === "json_object"
      ? { type: "json_object" as const }
      : {
          type: "json_schema" as const,
          name: format.name,
          schema: format.schema,
          strict: true,
        };
  return { format: outputFormat, ...(verbosity ? { verbosity } : {}) };
}

async function generateChatText(request: TextRequest): Promise<string> {
  const messages = request.messages.map((message) => ({ ...message }));
  const maxRequests = request.continuation?.maxRequests ?? 1;
  let output = "";
  for (let attempt = 0; attempt < maxRequests; attempt += 1) {
    request.signal?.throwIfAborted();
    const completion = await request.client.chat.completions.create(
      {
        model: request.model,
        messages,
        ...request.modelParams,
        response_format: chatFormat(request.format),
        max_completion_tokens: request.maxOutputTokens,
        safety_identifier: request.safetyIdentifier,
        store: false,
      },
      request.signal ? { signal: request.signal } : undefined,
    );
    request.signal?.throwIfAborted();
    const choice = completion.choices[0];
    if (choice?.message.refusal) {
      throw new Error("OpenAI text generation refused.");
    }
    const content = choice?.message.content ?? "";
    if (!content) {
      if (output) throw new Error("OpenAI text generation incomplete.");
      return "";
    }
    output += content;
    if (choice?.finish_reason !== "length") return output;
    if (request.format.kind !== "text") {
      throw new Error("OpenAI structured output incomplete.");
    }
    messages.push({ role: "assistant", content });
  }
  throw new Error("OpenAI text generation request limit exhausted.");
}

function assertResponseHasNoRefusal(response: Response): void {
  const refused = response.output.some(
    (item) =>
      item.type === "message" &&
      item.content.some((part) => part.type === "refusal"),
  );
  if (refused) throw new Error("OpenAI Responses generation refused.");
}

function canContinue(response: Response, format: OpenAITextFormat): boolean {
  return (
    response.status === "incomplete" &&
    response.incomplete_details?.reason === "max_output_tokens" &&
    format.kind === "text" &&
    Boolean(response.output_text.trim())
  );
}

async function generateResponsesText(request: TextRequest): Promise<string> {
  const input: ResponseInputItem[] = request.messages.map((message) => ({
    ...message,
  }));
  const maxRequests = request.continuation?.maxRequests ?? 1;
  let output = "";
  let previousText = "";
  for (let attempt = 0; attempt < maxRequests; attempt += 1) {
    request.signal?.throwIfAborted();
    const response = await request.client.responses.create(
      {
        model: request.model,
        input,
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: request.modelParams.reasoning_effort
          ? { effort: request.modelParams.reasoning_effort }
          : undefined,
        temperature: request.modelParams.temperature,
        text: responseText(request),
        max_output_tokens: request.maxOutputTokens,
        safety_identifier: request.safetyIdentifier,
      },
      request.signal ? { signal: request.signal } : undefined,
    );
    request.signal?.throwIfAborted();
    assertResponseHasNoRefusal(response);
    const text = response.output_text;
    if (response.status === "completed") {
      if (!text.trim()) throw new Error("OpenAI Responses output empty.");
      return output + text;
    }
    if (!canContinue(response, request.format)) {
      throw new Error("OpenAI Responses generation incomplete or failed.");
    }
    if (text === previousText) {
      throw new Error("OpenAI Responses continuation made no progress.");
    }
    output += text;
    previousText = text;
    input.push(
      ...toResponseInputItems(response.output),
      {
        role: "user",
        content:
          "Continue exactly where the previous output stopped. Do not repeat earlier text.",
      },
    );
  }
  throw new Error("OpenAI Responses request limit exhausted.");
}

export async function generateOpenAIText(
  options: TextGenerationOptions,
): Promise<string> {
  options.signal?.throwIfAborted();
  const api = options.api ?? config.openai.textApi;
  const format: OpenAITextFormat = options.format ?? { kind: "text" };
  const client = createOpenAIClient({
    ...options.tracing,
    metadata: {
      ...options.tracing?.metadata,
      api,
      outputFormat: format.kind,
      reasoningEffort: options.modelParams.reasoning_effort,
      verbosity: options.modelParams.verbosity,
    },
  });
  const request: TextRequest = { ...options, api, format, client };
  return api === "responses"
    ? generateResponsesText(request)
    : generateChatText(request);
}
