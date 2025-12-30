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

  loadingGlobal(): Locator {
    return this.page.getByTestId(testIds.settings.loadingGlobal).first();
  }

  loadingOverrides(): Locator {
    return this.page.getByTestId(testIds.settings.loadingOverrides).first();
  }

  async waitForLoaded(expectedOverrideName?: string): Promise<void> {
    await this.root().waitFor({ state: "visible" });
    await this.loadingGlobal().waitFor({ state: "hidden" });
    await this.loadingOverrides().waitFor({ state: "hidden" });
    if (expectedOverrideName) {
      await this.overrideByName(expectedOverrideName).waitFor({
        state: "visible",
      });
    } else {
      await this.firstOverride().waitFor({ state: "visible" });
    }
  }

  overrideByName(name: string): Locator {
    return this.overrides().filter({ hasText: name }).first();
  }

  removeFirstOverride(): Locator {
    return this.firstOverride().getByRole("button", {
      name: /remove override/i,
    });
  }

  async openFirstOverrideEdit(): Promise<void> {
    await this.firstOverride().click();
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

  saveDefaultsButton(): Locator {
    return this.page.getByTestId("settings-save-defaults");
  }

  chatTtsToggle(): Locator {
    return this.page.getByRole("button", { name: /chat tts/i });
  }

  chronoteVoiceSelect(): Locator {
    return this.page.getByRole("textbox", { name: /live voice tts voice/i });
  }

  chatTtsVoiceSelect(): Locator {
    return this.page.getByPlaceholder(/chat tts voice/i);
  }

  async selectChronoteVoice(label: string): Promise<void> {
    await this.chronoteVoiceSelect().click();
    await this.page.getByRole("option", { name: label }).click();
  }

  async selectChatTtsVoice(label: string): Promise<void> {
    await this.chatTtsVoiceSelect().click();
    await this.page.getByRole("option", { name: label }).click();
  }
}
