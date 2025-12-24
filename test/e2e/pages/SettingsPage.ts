import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class SettingsPage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId(testIds.settings.page);
  }

  addChannelButton(): Locator {
    return this.page.getByTestId(testIds.settings.addChannel);
  }

  refreshChannelsButton(): Locator {
    return this.page.getByTestId(testIds.settings.refreshChannels);
  }

  firstOverride(): Locator {
    return this.page.getByTestId(testIds.settings.override).first();
  }

  overrides(): Locator {
    return this.page.getByTestId(testIds.settings.override);
  }

  overrideByName(name: string): Locator {
    return this.overrides().filter({ hasText: name }).first();
  }

  removeFirstOverride(): Locator {
    return this.firstOverride().getByTestId(testIds.settings.removeOverride);
  }

  async openFirstOverrideEdit(): Promise<void> {
    await this.firstOverride().getByRole("button", { name: /edit/i }).click();
  }

  modal(): Locator {
    return this.page.getByTestId(testIds.settings.modal);
  }

  modalTitle(): Locator {
    return this.page.getByRole("heading", { name: /channel settings/i });
  }

  tagInput(): Locator {
    return this.modal().getByLabel(/tags/i);
  }

  saveChannelButton(): Locator {
    return this.modal().getByTestId(testIds.settings.saveChannel);
  }
}
