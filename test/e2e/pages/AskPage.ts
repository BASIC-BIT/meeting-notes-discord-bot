import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class AskPage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId(testIds.ask.page);
  }

  async startNewChat(): Promise<void> {
    await this.page.getByTestId(testIds.ask.new).click();
  }

  title(): Locator {
    return this.page.getByTestId(testIds.ask.title);
  }

  listMode(): Locator {
    return this.page.getByTestId(testIds.ask.listMode);
  }

  async switchListMode(mode: "mine" | "shared" | "archived"): Promise<void> {
    const label =
      mode === "shared"
        ? "Shared"
        : mode === "archived"
          ? "Archived"
          : "My chats";
    await this.listMode().getByText(label).click();
  }

  loadingList(): Locator {
    return this.page.getByTestId(testIds.ask.loadingList).first();
  }

  loadingPane(): Locator {
    return this.page.getByTestId(testIds.ask.loadingPane).first();
  }

  input(): Locator {
    return this.page.getByTestId(testIds.ask.input);
  }

  conversationItemByTitle(title: string): Locator {
    return this.page
      .getByTestId(testIds.ask.conversationItem)
      .filter({ hasText: title })
      .first();
  }

  async waitForReady(expectedTitle?: string): Promise<void> {
    await this.root().waitFor({ state: "visible" });
    await this.loadingList().waitFor({ state: "hidden" });
    await this.loadingPane().waitFor({ state: "hidden" });
    if (expectedTitle) {
      await this.conversationItemByTitle(expectedTitle).waitFor({
        state: "visible",
      });
    }
  }

  async ask(question: string): Promise<void> {
    await this.input().fill(question);
    await this.page.getByTestId(testIds.ask.send).click();
  }

  async askWithKeyboard(question: string): Promise<void> {
    await this.input().fill(question);
    await this.input().press("Control+Enter");
  }

  renameButton(): Locator {
    return this.page.getByTestId(testIds.ask.rename);
  }

  renameInput(): Locator {
    return this.page.getByTestId(testIds.ask.renameInput);
  }

  archiveButton(): Locator {
    return this.page.getByTestId(testIds.ask.archive);
  }

  unarchiveButton(): Locator {
    return this.page.getByTestId(testIds.ask.unarchive);
  }

  archiveConfirmButton(): Locator {
    return this.page.getByTestId(testIds.ask.archiveConfirm);
  }

  async renameTo(title: string): Promise<void> {
    await this.renameButton().click();
    await this.renameInput().fill(title);
    await this.renameInput().press("Enter");
  }

  userMessage(text: string): Locator {
    return this.page
      .locator(`[data-testid="${testIds.ask.message}"][data-role="user"]`)
      .filter({ hasText: text });
  }

  latestChronoteMessage(): Locator {
    return this.page
      .locator(`[data-testid="${testIds.ask.message}"][data-role="chronote"]`)
      .last();
  }
}
