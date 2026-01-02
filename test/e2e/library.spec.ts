import { expect, test } from "./fixtures";
import { mockGuilds, mockLibrary } from "./mockData";

test("library page shows meetings and drawer details (mock)", async ({
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
  await expect(libraryPage.drawerTimelineLabel()).toBeVisible();
  await expect(libraryPage.drawerDownload()).toBeVisible();
  await libraryPage.drawerArchive().click();
  await expect(libraryPage.drawer()).toBeHidden();

  await libraryPage.selectArchiveView("archived");
  await libraryPage.waitForLoaded();
  await expect(
    libraryPage.meetingRowByText(mockLibrary.meetingTitle),
  ).toBeVisible();
});
