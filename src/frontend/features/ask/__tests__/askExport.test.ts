import { describe, expect, test } from "@jest/globals";
import type { AskConversation, AskMessage } from "../../../../types/ask";
import {
  buildAskThreadExport,
  formatAskThreadText,
} from "../../../utils/askExport";

const buildConversation = (): AskConversation => ({
  id: "conv-1",
  title: "Weekly sync",
  summary: "Summary",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:10:00.000Z",
  visibility: "private",
});

const buildMessages = (): AskMessage[] => [
  {
    id: "msg-1",
    role: "user",
    text: "What did we decide?",
    createdAt: "2025-01-01T00:05:00.000Z",
  },
  {
    id: "msg-2",
    role: "chronote",
    text: "We decided to ship on Friday. [1]",
    createdAt: "2025-01-01T00:05:10.000Z",
  },
];

describe("askExport helpers", () => {
  test("builds JSON export payload", () => {
    const payload = buildAskThreadExport({
      serverId: "guild-1",
      conversation: buildConversation(),
      messages: buildMessages(),
      exportedAt: "2025-01-01T00:20:00.000Z",
    });
    expect(payload.serverId).toBe("guild-1");
    expect(payload.exportedAt).toBe("2025-01-01T00:20:00.000Z");
    expect(payload.conversation.title).toBe("Weekly sync");
    expect(payload.messages).toHaveLength(2);
  });

  test("formats text export", () => {
    const output = formatAskThreadText({
      conversation: buildConversation(),
      messages: buildMessages(),
      exportedAt: "2025-01-01T00:20:00.000Z",
    });
    expect(output).toContain("Conversation: Weekly sync");
    expect(output).toContain("Exported: 2025-01-01T00:20:00.000Z");
    expect(output).toContain("You:");
    expect(output).toContain("Chronote:");
  });
});
