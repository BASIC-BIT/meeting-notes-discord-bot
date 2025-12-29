import { expect, test } from "./fixtures";
import { mockGuilds, mockSettings } from "./mockData";

test("settings page shows overrides and updates tags (mock)", async ({
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

  await expect(settingsPage.chatTtsToggle()).toBeVisible();
  await settingsPage.chatTtsToggle().click();
  await settingsPage.selectChronoteVoice("Nova");
  await settingsPage.selectChatTtsVoice("Alloy");
  await settingsPage.saveDefaultsButton().click();

  const override = mockSettings.overrideChannelName
    ? settingsPage.overrideByName(mockSettings.overrideChannelName)
    : settingsPage.firstOverride();
  await expect(override).toBeVisible();
  if (mockSettings.overrideTag) {
    await expect(override).toContainText(mockSettings.overrideTag);
  }

  await settingsPage.openFirstOverrideEdit();
  await expect(settingsPage.modalTitle()).toBeVisible();
  await settingsPage.tagInput().fill("raid, recap");
  await settingsPage.saveChannelButton().click();
  await expect(settingsPage.modal()).toBeHidden();
  await expect(settingsPage.firstOverride()).toContainText("raid");

  const overridesBefore = await settingsPage.overrides().count();
  await settingsPage.removeFirstOverride().click();
  await expect(settingsPage.overrides()).toHaveCount(overridesBefore - 1);

  const refresh = settingsPage.refreshChannelsButton();
  await refresh.click();
  await expect(refresh).toBeVisible();
});
