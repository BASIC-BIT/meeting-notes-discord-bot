import { expect, test } from "./fixtures";
import { mockGuilds, mockSettings } from "./mockData";

test("settings page shows overrides and updates tags (mock)", async ({
  page,
  serverSelectPage,
  nav,
  settingsPage,
}) => {
  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.ddm.name);

  await nav.goToSettings();
  await expect(settingsPage.root()).toBeVisible();
  await settingsPage.waitForLoaded(
    mockSettings.overrideChannelName || undefined,
  );

  const chatTtsEntry = page.getByTestId(
    "settings-config-entry-chatTts.enabled",
  );
  await chatTtsEntry.scrollIntoViewIfNeeded();
  await chatTtsEntry.getByText("On", { exact: true }).click();

  const liveVoiceEntry = page.getByTestId(
    "settings-config-entry-liveVoice.enabled",
  );
  await liveVoiceEntry.scrollIntoViewIfNeeded();
  await liveVoiceEntry.getByText("On", { exact: true }).click();

  const liveVoiceVoiceEntry = page.getByTestId(
    "settings-config-entry-liveVoice.ttsVoice",
  );
  await liveVoiceVoiceEntry.scrollIntoViewIfNeeded();
  await liveVoiceVoiceEntry.getByLabel("liveVoice.ttsVoice").click();
  await page.getByRole("option", { name: "Nova" }).click();

  const chatTtsVoiceEntry = page.getByTestId(
    "settings-config-entry-chatTts.voice",
  );
  await chatTtsVoiceEntry.scrollIntoViewIfNeeded();
  await chatTtsVoiceEntry.getByLabel("chatTts.voice").click();
  await page.getByRole("option", { name: "Alloy" }).click();

  await settingsPage.saveConfigButton().click();

  const override = mockSettings.overrideChannelName
    ? settingsPage.overrideByName(mockSettings.overrideChannelName)
    : settingsPage.firstOverride();
  await expect(override).toBeVisible();

  await settingsPage.openFirstOverrideEdit();
  await expect(settingsPage.modalTitle()).toBeVisible();
  await settingsPage.tagInput().fill("raid, recap");
  await settingsPage.saveChannelButton().click();
  await expect(settingsPage.modal()).toBeHidden();
  await settingsPage.openFirstOverrideEdit();
  await expect(settingsPage.tagInput()).toHaveValue("raid, recap");
  await settingsPage.saveChannelButton().click();
  await expect(settingsPage.modal()).toBeHidden();

  const overridesBefore = await settingsPage.overrides().count();
  await settingsPage.removeFirstOverride().click();
  await expect(settingsPage.overrides()).toHaveCount(overridesBefore - 1);

  const refresh = settingsPage.refreshChannelsButton();
  await refresh.click();
  await expect(refresh).toBeVisible();
});
