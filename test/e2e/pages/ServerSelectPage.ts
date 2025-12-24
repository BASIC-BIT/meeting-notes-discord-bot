import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class ServerSelectPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/portal/select-server");
  }

  root(): Locator {
    return this.page.getByTestId(testIds.serverSelect.root);
  }

  firstServerCard(): Locator {
    return this.page.getByTestId(testIds.serverSelect.card).first();
  }

  serverCardByName(name: string): Locator {
    return this.page.getByTestId(testIds.serverSelect.card).filter({
      hasText: name,
    });
  }

  async openFirstServer(): Promise<void> {
    const card = this.firstServerCard();
    await card.getByTestId(testIds.serverSelect.open).click();
  }

  async openServerByName(name: string): Promise<void> {
    const card = this.serverCardByName(name).first();
    await card.getByTestId(testIds.serverSelect.open).click();
  }
}
