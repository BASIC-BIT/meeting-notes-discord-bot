import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class AdminConfigPage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId(testIds.adminConfig.page);
  }

  publishButton(): Locator {
    return this.page.getByTestId(testIds.adminConfig.publish);
  }

  refreshButton(): Locator {
    return this.page.getByTestId(testIds.adminConfig.refresh);
  }

  entryByKey(key: string): Locator {
    return this.page.getByTestId(`admin-config-entry-${key}`);
  }

  async expandGroup(label: string): Promise<void> {
    const control = this.root().getByRole("button", { name: label }).first();
    if (await control.count()) {
      const expanded = await control.getAttribute("aria-expanded");
      if (expanded !== "true") {
        await control.click();
      }
    }
  }

  async waitForLoaded(entryKey?: string): Promise<void> {
    await this.root().waitFor({ state: "visible" });
    if (entryKey) {
      await this.entryByKey(entryKey).waitFor({ state: "visible" });
    } else {
      await this.page
        .locator('[data-testid^="admin-config-entry-"]')
        .first()
        .waitFor({ state: "visible" });
    }
  }
}
