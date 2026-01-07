import { expect, test } from "./fixtures";
import { mockGuilds, mockLibrary } from "./mockData";

test("library page shows meetings and drawer details (mock)", async ({
  page,
  serverSelectPage,
  nav,
  libraryPage,
}) => {
  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.ddm.name);

  await nav.goToLibrary();
  await expect(libraryPage.root()).toBeVisible();
  await libraryPage.waitForLoaded(mockLibrary.meetingCount);
  await expect(libraryPage.meetingRows()).toHaveCount(mockLibrary.meetingCount);

  await libraryPage.searchInput().fill(mockLibrary.meetingTitle);
  await expect(
    libraryPage.meetingRowByText(mockLibrary.meetingTitle),
  ).toBeVisible();

  await libraryPage.refreshButton().click();
  await expect(
    libraryPage.meetingRowByText(mockLibrary.meetingTitle),
  ).toBeVisible();

  await libraryPage.openFirstMeeting();
  await expect(libraryPage.drawerSummaryLabel()).toBeVisible();
  await expect(libraryPage.drawerDownload()).toBeVisible();
  await expect(libraryPage.drawerSummaryScroll()).toBeVisible();

  const pageScroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(pageScroll.scrollHeight).toBeLessThanOrEqual(
    pageScroll.clientHeight + 1,
  );

  const drawerScroll = await libraryPage.drawerContent().evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  expect(drawerScroll.scrollHeight).toBeLessThanOrEqual(
    drawerScroll.clientHeight + 1,
  );

  const drawerDialog = page.getByRole("dialog");
  const dialogOverflowY = await drawerDialog.evaluate(
    (node) => window.getComputedStyle(node).overflowY,
  );
  expect(dialogOverflowY).toBe("hidden");

  const summaryScroll = await libraryPage
    .drawerSummaryViewport()
    .evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
  expect(summaryScroll.scrollHeight).toBeGreaterThan(
    summaryScroll.clientHeight,
  );

  await libraryPage.drawerFullscreenToggle().click();
  await expect(libraryPage.drawerTimelineViewport()).toBeVisible();
  await expect(libraryPage.drawerTimelineEvents().first()).toBeVisible();

  await libraryPage.drawerArchive().click();
  await expect(libraryPage.drawerArchiveConfirm()).toBeVisible();
  await libraryPage.drawerArchiveConfirm().click();
  await expect(libraryPage.drawer()).toBeHidden();

  await libraryPage.selectArchiveView("archived");
  await libraryPage.waitForLoaded();
  await expect(
    libraryPage.meetingRowByText(mockLibrary.meetingTitle),
  ).toBeVisible();
});
