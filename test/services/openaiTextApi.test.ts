import { expect, test } from "@jest/globals";
import { resolveOpenAITextApi } from "../../src/config/openaiText";

test("text API configuration keeps Chat as the compatibility default", () => {
  expect(resolveOpenAITextApi()).toBe("chat_completions");
});

test("text API configuration accepts the explicit Responses route", () => {
  expect(resolveOpenAITextApi(" responses ")).toBe("responses");
});

test("text API configuration rejects unknown transports", () => {
  expect(() => resolveOpenAITextApi("unknown")).toThrow(/OPENAI_TEXT_API/);
});
