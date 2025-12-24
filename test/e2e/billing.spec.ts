import { expect, test } from "./fixtures";
import { mockBilling, mockGuilds } from "./mockData";

test("billing page shows paid and free states (mock)", async ({
  serverSelectPage,
  nav,
  billingPage,
}) => {
  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.ddm.name);

  await nav.goToBilling();
  await expect(billingPage.root()).toBeVisible();
  await expect(billingPage.currentPlan()).toContainText(
    mockBilling.paidTierLabel,
  );
  await expect(billingPage.manageButton()).toBeVisible();
  await billingPage.expandPlans();
  await billingPage
    .intervalToggle()
    .getByText(/annual/i)
    .click();
  await expect(billingPage.plans()).toContainText("/ yr");

  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.chronote.name);
  await nav.goToBilling();
  await expect(billingPage.currentPlan()).toContainText(/free plan/i);
});
