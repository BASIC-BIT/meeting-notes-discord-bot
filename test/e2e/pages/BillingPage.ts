import type { Locator, Page } from "@playwright/test";
import { testIds } from "./testIds";

export class BillingPage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId(testIds.billing.page);
  }

  currentPlan(): Locator {
    return this.page.getByTestId(testIds.billing.currentPlan);
  }

  plans(): Locator {
    return this.page.getByTestId(testIds.billing.plans);
  }

  freePlan(): Locator {
    return this.page.getByTestId(testIds.billing.planFree);
  }

  manageButton(): Locator {
    return this.page.getByTestId(testIds.billing.manage);
  }

  intervalToggle(): Locator {
    return this.page.getByTestId(testIds.billing.interval);
  }

  async expandPlans(): Promise<void> {
    const toggle = this.page.getByRole("button", { name: /compare plans/i });
    if (await toggle.isVisible()) {
      await toggle.click();
    }
  }

  async waitForLoaded(): Promise<void> {
    await this.root().waitFor({ state: "visible" });
    await this.currentPlan().waitFor({ state: "visible" });
  }
}
