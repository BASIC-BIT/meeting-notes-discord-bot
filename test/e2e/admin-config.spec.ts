import { expect, test } from "./fixtures";
import { mockGuilds } from "./mockData";

test("admin config toggles update", async ({
  serverSelectPage,
  nav,
  adminConfigPage,
}) => {
  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.ddm.name);
  await nav.goToAdminConfig();
  await adminConfigPage.waitForLoaded();
  await adminConfigPage.expandGroup("Experimental");

  const entry = adminConfigPage.entryByKey("transcription.premium.enabled");
  const offLabel = entry.locator("label", { hasText: /^off$/i }).first();
  await offLabel.click();
  await expect(entry.getByRole("button", { name: /reset/i })).toBeVisible();

  const onLabel = entry.locator("label", { hasText: /^on$/i }).first();
  await onLabel.click();
  await expect(entry.locator('input[type="radio"][value="on"]')).toBeChecked();
});
