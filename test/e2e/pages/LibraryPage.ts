import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class LibraryPage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId(testIds.library.page);
  }

  searchInput(): Locator {
    return this.page.getByTestId(testIds.library.search);
  }

  refreshButton(): Locator {
    return this.page.getByTestId(testIds.library.refresh);
  }

  meetingRows(): Locator {
    return this.page.getByTestId(testIds.library.meetingRow);
  }

  loadingIndicator(): Locator {
    return this.page.getByTestId(testIds.library.loading);
  }

  meetingRowByText(text: string): Locator {
    return this.meetingRows().filter({ hasText: text });
  }

  async waitForLoaded(expectedCount?: number): Promise<void> {
    await this.root().waitFor({ state: "visible" });
    await this.loadingIndicator().waitFor({ state: "hidden" });
    if (typeof expectedCount === "number") {
      if (expectedCount > 0) {
        await this.meetingRows().first().waitFor({ state: "visible" });
      }
    }
  }

  firstMeeting(): Locator {
    return this.meetingRows().first();
  }

  async openFirstMeeting(): Promise<void> {
    const row = this.firstMeeting();
    await row.click({ position: { x: 12, y: 12 } });
  }

  drawer(): Locator {
    return this.page.getByTestId(testIds.library.drawer);
  }

  drawerDownload(): Locator {
    return this.drawer().getByTestId(testIds.library.download);
  }

  drawerSummaryLabel(): Locator {
    return this.drawer().getByText("Summary", { exact: true }).first();
  }

  drawerTimelineLabel(): Locator {
    return this.drawer().getByText("Timeline", { exact: true }).first();
  }

  async closeDrawer(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }
}
