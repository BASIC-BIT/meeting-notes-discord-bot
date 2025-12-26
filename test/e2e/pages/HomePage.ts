import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class HomePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  hero(): Locator {
    return this.page.getByTestId(testIds.home.hero);
  }

  ctaDiscord(): Locator {
    return this.page.getByTestId(testIds.home.ctaDiscord);
  }
}
