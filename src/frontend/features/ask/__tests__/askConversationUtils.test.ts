import { describe, expect, test } from "@jest/globals";
import type { AskConversation, AskMessage } from "../../../../types/ask";
import {
  buildConversationMessagesUpdate,
  buildOptimisticConversation,
  buildOptimisticUserMessage,
  canSubmitAsk,
  mergeAskMessages,
} from "../askConversationUtils";

const baseConversation: AskConversation = {
  id: "conv-1",
  title: "Weekly sync",
  summary: "Summary",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:10:00.000Z",
  visibility: "private",
};

const buildMessage = (overrides: Partial<AskMessage>): AskMessage => ({
  id: "msg-1",
  role: "user",
  text: "Hello",
  createdAt: "2025-01-01T00:05:00.000Z",
  ...overrides,
});

describe("askConversationUtils", () => {
  test("builds optimistic messages and conversation", () => {
    const createdAt = "2025-01-01T00:00:00.000Z";
    const question = "What did we decide about the roadmap?";
    const optimisticMessage = buildOptimisticUserMessage(question, createdAt);
    const optimisticConversation = buildOptimisticConversation(
      question.repeat(5),
      createdAt,
    );

    expect(optimisticMessage.id).toBe(`optimistic-${createdAt}`);
    expect(optimisticMessage.text).toBe(question);
    expect(optimisticConversation.id).toBe("pending");
    expect(optimisticConversation.updatedAt).toBe(createdAt);
    expect(optimisticConversation.title.endsWith("...")).toBe(true);
  });

  test("dedupes merged messages", () => {
    const existing = [buildMessage({ id: "a" }), buildMessage({ id: "b" })];
    const incoming = [buildMessage({ id: "b" }), buildMessage({ id: "c" })];

    expect(mergeAskMessages(existing, incoming).map((msg) => msg.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("builds conversation message update with merge", () => {
    const existing = [buildMessage({ id: "a" }), buildMessage({ id: "b" })];
    const incoming = [buildMessage({ id: "b" }), buildMessage({ id: "c" })];
    const update = buildConversationMessagesUpdate(baseConversation, incoming);

    const result = update({ messages: existing });
    expect(result.conversation.id).toBe(baseConversation.id);
    expect(result.messages.map((msg) => msg.id)).toEqual(["a", "b", "c"]);
  });

  test("guards ask submission", () => {
    expect(
      canSubmitAsk({
        selectedGuildId: null,
        question: "Hello",
        listMode: "mine",
        askAccessAllowed: true,
        isArchived: false,
      }),
    ).toBe(false);
    expect(
      canSubmitAsk({
        selectedGuildId: "guild-1",
        question: "Hello",
        listMode: "mine",
        askAccessAllowed: true,
        isArchived: false,
      }),
    ).toBe(true);
  });
});
