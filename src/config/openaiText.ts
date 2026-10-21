export type OpenAITextApi = "chat_completions" | "responses";

export function resolveOpenAITextApi(value?: string): OpenAITextApi {
  const api = value?.trim() || "chat_completions";
  switch (api) {
    case "chat_completions":
    case "responses":
      return api;
    default:
      throw new Error("OPENAI_TEXT_API must be chat_completions or responses.");
  }
}
