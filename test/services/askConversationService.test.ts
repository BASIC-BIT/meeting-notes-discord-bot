import {
  listAskConversations,
  listSharedAskConversations,
  setAskConversationArchived,
} from "../../src/services/askConversationService";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";

describe("askConversationService archive", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("archives a conversation and hides it from shared list", async () => {
    const store = getMockStore();
    const guildId = store.userGuilds[0].id;
    const userId = store.user.id;
    const conversation = store.askConversationsByKey
      .get(`USER#${userId}#GUILD#${guildId}`)
      ?.find((conv) => conv.visibility === "server");

    expect(conversation).toBeDefined();
    if (!conversation) return;

    const updated = await setAskConversationArchived({
      userId,
      guildId,
      conversationId: conversation.id,
      archived: true,
    });
    expect(updated?.archivedAt).toBeTruthy();

    const mine = await listAskConversations(userId, guildId);
    const archived = mine.find((conv) => conv.id === conversation.id);
    expect(archived?.archivedAt).toBeTruthy();

    const shared = await listSharedAskConversations(guildId, "viewer-2");
    expect(shared.some((conv) => conv.conversationId === conversation.id)).toBe(
      false,
    );
  });
});
