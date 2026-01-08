import { beforeEach, describe, expect, it } from "@jest/globals";
import { getFeedbackRepository } from "../../src/repositories/feedbackRepository";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import { submitAskFeedback } from "../../src/services/askFeedbackService";

describe("submitAskFeedback", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("stores ask feedback for a conversation message", async () => {
    const store = getMockStore();
    const guildId = store.userGuilds[0]?.id ?? "guild-1";
    const result = await submitAskFeedback({
      guildId,
      conversationId: "conv-1",
      messageId: "msg-1",
      userId: "user-1",
      rating: "up",
      comment: "Helpful answer.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fetched = await getFeedbackRepository().get(
      result.record.pk,
      result.record.sk,
    );
    expect(fetched).toBeDefined();
    expect(fetched?.targetType).toBe("ask_answer");
    expect(fetched?.targetId).toBe("conv-1#msg-1");
    expect(fetched?.conversationId).toBe("conv-1");
    expect(fetched?.messageId).toBe("msg-1");
    expect(fetched?.comment).toBe("Helpful answer.");
  });

  it("uses channel id when no conversation id is provided", async () => {
    const result = await submitAskFeedback({
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "msg-2",
      userId: "user-2",
      rating: "down",
    });

    expect(result.record.targetId).toBe("channel-1#msg-2");
    expect(result.record.channelId).toBe("channel-1");
  });

  it("trims long comments", async () => {
    const comment = "a".repeat(1205);
    const result = await submitAskFeedback({
      guildId: "guild-1",
      conversationId: "conv-2",
      messageId: "msg-3",
      userId: "user-3",
      rating: "down",
      comment,
    });

    expect(result.record.comment?.length).toBe(1000);
  });
});
