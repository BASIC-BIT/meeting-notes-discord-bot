import type { Page } from "@playwright/test";

export async function applyVisualDefaults(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.setAttribute("data-visual-test", "true");
    style.textContent = `
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
        }
        html {
          scroll-behavior: auto !important;
        }
        body {
          caret-color: transparent !important;
        }
      `;
    (document.head || document.documentElement).appendChild(style);
  });
}

export async function waitForVisualReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}
