import {
  buildAskUrl,
  buildDisplayMessages,
  buildPublicAskUrl,
  formatTime,
  formatUpdated,
  resolveListMode,
  truncate,
} from "../../../utils/askLinks";
import type { AskMessage } from "../../../../types/ask";

describe("askLinks helpers", () => {
  it("builds ask URL with list mode and optional messageId", () => {
    const url = buildAskUrl({
      origin: "https://example.com",
      serverId: "123",
      conversationId: "abc",
      listMode: "shared",
      messageId: "mid",
    });
    expect(url).toBe(
      "https://example.com/portal/server/123/ask?conversationId=abc&list=shared&messageId=mid",
    );
  });

  it("builds public ask URL", () => {
    const url = buildPublicAskUrl({
      origin: "https://example.com",
      serverId: "123",
      conversationId: "abc",
    });
    expect(url).toBe("https://example.com/share/ask/123/abc");
  });

  it("resolves list mode", () => {
    expect(resolveListMode("shared")).toBe("shared");
    expect(resolveListMode("archived")).toBe("archived");
    expect(resolveListMode("mine")).toBe("mine");
    expect(resolveListMode(null)).toBe("mine");
  });

  it("formats time and date", () => {
    const iso = "2024-01-02T03:04:05.000Z";
    expect(formatTime(iso)).toMatch(/\d{2}:\d{2}/);
    expect(formatUpdated(iso)).toMatch(/Jan \d{1,2}/);
  });

  it("truncates strings", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("averylongstring", 5)).toBe("avery...");
  });

  it("buildDisplayMessages keeps optimistic + pending", () => {
    const optimistic: AskMessage[] = [
      { id: "o1", role: "user", text: "hi", createdAt: "2024-01-02" },
    ];
    const result = buildDisplayMessages({
      activeConversation: null,
      activeId: null,
      activeMessages: [],
      optimisticMessages: optimistic,
      isPending: true,
    });
    expect(result.map((m) => m.id)).toEqual(["o1", "thinking"]);
  });
});
