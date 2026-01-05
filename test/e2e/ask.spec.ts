import { expect, test } from "./fixtures";
import { mockAsk, mockGuilds } from "./mockData";

test("ask page lists conversations and sends a question (mock)", async ({
  serverSelectPage,
  nav,
  askPage,
}) => {
  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.ddm.name);

  await nav.goToAsk();
  await expect(askPage.root()).toBeVisible();
  await askPage.waitForReady(mockAsk.conversationTitle);

  if (mockAsk.conversationTitle) {
    const conversation = askPage.conversationItemByTitle(
      mockAsk.conversationTitle,
    );
    await expect(conversation).toBeVisible();
    if (mockAsk.conversationSummarySnippet) {
      await expect(conversation).toContainText(
        mockAsk.conversationSummarySnippet,
      );
    }
  }

  await askPage.startNewChat();
  await expect(askPage.title()).toContainText(/new chat/i);

  const question = "Summarize the last session.";
  await askPage.askWithKeyboard(question);
  await expect(askPage.userMessage(question)).toBeVisible();
  await expect(askPage.latestChronoteMessage()).toContainText(
    /mock answer for/i,
    {
      timeout: 15000,
    },
  );
  await expect(askPage.input()).toBeEnabled({ timeout: 15000 });
  await expect(askPage.input()).toBeFocused();

  if (mockAsk.conversationTitle) {
    await askPage.switchListMode("mine");
    await askPage.conversationItemByTitle(mockAsk.conversationTitle).click();
    await expect(askPage.archiveButton()).toBeVisible();
    await askPage.archiveButton().click();
    await expect(askPage.archiveConfirmButton()).toBeVisible();
    await askPage.archiveConfirmButton().click();
    await askPage.switchListMode("archived");
    await expect(
      askPage.conversationItemByTitle(mockAsk.conversationTitle),
    ).toBeVisible();
    await askPage.conversationItemByTitle(mockAsk.conversationTitle).click();
    await expect(askPage.unarchiveButton()).toBeVisible();
  }
});
