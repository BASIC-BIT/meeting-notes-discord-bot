import { describe, expect, test } from "@jest/globals";
import { DEFAULT_THEME } from "@mantine/core";
import {
  appBackground,
  portalBackground,
  shellBorder,
  uiGradients,
} from "../../src/frontend/uiTokens";

describe("uiTokens", () => {
  test("shellBorder uses theme colors", () => {
    expect(shellBorder(DEFAULT_THEME, false)).toBe(
      `1px solid ${DEFAULT_THEME.colors.gray[2]}`,
    );
    expect(shellBorder(DEFAULT_THEME, true)).toBe(
      `1px solid ${DEFAULT_THEME.colors.dark[4]}`,
    );
  });

  test("background helpers return dark and light variants", () => {
    expect(appBackground(DEFAULT_THEME, true)).toBe("#0b1020");
    expect(appBackground(DEFAULT_THEME, false)).toBe(
      DEFAULT_THEME.colors.gray[0],
    );
    expect(uiGradients.billingPanel(true)).not.toBe(
      uiGradients.billingPanel(false),
    );
    expect(portalBackground(true)).not.toBe(portalBackground(false));
  });
});
