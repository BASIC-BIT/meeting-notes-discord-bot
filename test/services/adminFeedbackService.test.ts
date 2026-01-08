import { beforeEach, describe, expect, it } from "@jest/globals";
import { getFeedbackRepository } from "../../src/repositories/feedbackRepository";
import { resetMockStore } from "../../src/repositories/mockStore";
import { listFeedbackEntries } from "../../src/services/adminFeedbackService";

describe("listFeedbackEntries", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("filters by target type and rating", async () => {
    const repo = getFeedbackRepository();
    await repo.write({
      pk: "TARGET#meeting_summary#voice-1#2025-01-01T00:00:00.000Z",
      sk: "USER#u1",
      type: "feedback",
      targetType: "meeting_summary",
      targetId: "voice-1#2025-01-01T00:00:00.000Z",
      guildId: "g1",
      rating: "up",
      source: "web",
      createdAt: "2025-01-02T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
      userId: "u1",
    });
    await repo.write({
      pk: "TARGET#ask_answer#conv-1#msg-1",
      sk: "USER#u2",
      type: "feedback",
      targetType: "ask_answer",
      targetId: "conv-1#msg-1",
      guildId: "g1",
      conversationId: "conv-1",
      messageId: "msg-1",
      rating: "down",
      source: "discord",
      createdAt: "2025-01-03T00:00:00.000Z",
      updatedAt: "2025-01-03T00:00:00.000Z",
      userId: "u2",
    });

    const items = await listFeedbackEntries({
      targetType: "ask_answer",
      rating: "down",
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.targetType).toBe("ask_answer");
    expect(items[0]?.rating).toBe("down");
  });
});
