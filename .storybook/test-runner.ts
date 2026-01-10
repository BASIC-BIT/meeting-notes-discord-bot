import type { TestRunnerConfig } from "@storybook/test-runner";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotsDir = resolve(rootDir, "test", "storybook", "screenshots");

const config: TestRunnerConfig = {
  async postVisit(page, context) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(150);
    await mkdir(screenshotsDir, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotsDir, `${context.id}.png`),
      fullPage: true,
    });
  },
};

export default config;
