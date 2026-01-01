import { expect, test } from "./fixtures";
import { mockGuilds, mockLibrary, mockSettings } from "./mockData";
import { applyVisualDefaults, waitForVisualReady } from "./visualUtils";

const runVisual = process.env.PW_VISUAL === "true";

test.describe("visual regression", () => {
  test.skip(!runVisual, "Visual regression disabled");

  test.use({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    timezoneId: "UTC",
  });

  test.beforeEach(async ({ page }) => {
    await applyVisualDefaults(page);
  });

  test("home page @visual", async ({ homePage, page }) => {
    await homePage.goto();
    await expect(homePage.hero()).toBeVisible();
    await waitForVisualReady(page);
    await expect(homePage.hero()).toHaveScreenshot("home-hero.png");
  });

  test("server select @visual", async ({ serverSelectPage, page }) => {
    await serverSelectPage.goto();
    await expect(serverSelectPage.root()).toBeVisible();
    await waitForVisualReady(page);
    await expect(serverSelectPage.root()).toHaveScreenshot("server-select.png");
  });

  test("library page @visual", async ({
    serverSelectPage,
    libraryPage,
    page,
  }) => {
    await serverSelectPage.goto();
    await serverSelectPage.openServerByName(mockGuilds.ddm.name);
    await libraryPage.waitForLoaded();
    await page.getByTestId("library-range").click();
    await page.getByRole("option", { name: "All time" }).click();
    await libraryPage.waitForLoaded(mockLibrary.meetingCount);
    await waitForVisualReady(page);
    await expect(libraryPage.root()).toHaveScreenshot("library-list.png");

    await libraryPage.openFirstMeeting();
    const drawerDialog = page.getByRole("dialog");
    await expect(drawerDialog).toBeVisible();
    await waitForVisualReady(page);
    await expect(drawerDialog).toHaveScreenshot("library-drawer.png");
  });

  test("ask page @visual", async ({ serverSelectPage, nav, askPage, page }) => {
    await serverSelectPage.goto();
    await serverSelectPage.openServerByName(mockGuilds.ddm.name);
    await nav.goToAsk();
    await askPage.waitForReady();
    await waitForVisualReady(page);
    await expect(askPage.root()).toHaveScreenshot("ask-list.png");

    await askPage.startNewChat();
    await expect(askPage.title()).toContainText(/new chat/i);
    await waitForVisualReady(page);
    await expect(askPage.root()).toHaveScreenshot("ask-new-chat.png");
  });

  test("billing page @visual", async ({
    serverSelectPage,
    nav,
    billingPage,
    page,
  }) => {
    await serverSelectPage.goto();
    await serverSelectPage.openServerByName(mockGuilds.ddm.name);
    await nav.goToBilling();
    await billingPage.waitForLoaded();
    await billingPage.expandPlans();
    await waitForVisualReady(page);
    await expect(billingPage.root()).toHaveScreenshot("billing-paid.png");

    await serverSelectPage.goto();
    await serverSelectPage.openServerByName(mockGuilds.chronote.name);
    await nav.goToBilling();
    await billingPage.waitForLoaded();
    await billingPage.expandPlans();
    await waitForVisualReady(page);
    await expect(billingPage.root()).toHaveScreenshot("billing-free.png");
  });

  test("settings page @visual", async ({
    serverSelectPage,
    nav,
    settingsPage,
    page,
  }) => {
    await serverSelectPage.goto();
    await serverSelectPage.openServerByName(mockGuilds.ddm.name);
    await nav.goToSettings();
    await settingsPage.waitForLoaded(
      mockSettings.overrideChannelName || undefined,
    );
    await waitForVisualReady(page);
    await expect(settingsPage.root()).toHaveScreenshot("settings.png");

    await settingsPage.openFirstOverrideEdit();
    const settingsDialog = page.getByRole("dialog", {
      name: /channel settings/i,
    });
    await expect(settingsDialog).toBeVisible();
    await waitForVisualReady(page);
    await expect(settingsDialog).toHaveScreenshot("settings-modal.png");
  });

  test("admin config page @visual", async ({
    serverSelectPage,
    nav,
    adminConfigPage,
    page,
  }) => {
    await serverSelectPage.goto();
    await serverSelectPage.openServerByName(mockGuilds.ddm.name);
    await nav.goToAdminConfig();
    await adminConfigPage.waitForLoaded();
    await adminConfigPage.expandGroup("Experimental");
    await adminConfigPage
      .entryByKey("transcription.premium.enabled")
      .waitFor({ state: "visible" });
    await waitForVisualReady(page);
    await expect(adminConfigPage.root()).toHaveScreenshot("admin-config.png");
  });
});
