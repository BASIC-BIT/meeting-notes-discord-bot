import { expect, test } from "./fixtures";

test("home page renders", async ({ homePage }) => {
  await homePage.goto();
  await expect(homePage.hero()).toBeVisible();
  await expect(homePage.ctaDiscord()).toBeVisible();
});
