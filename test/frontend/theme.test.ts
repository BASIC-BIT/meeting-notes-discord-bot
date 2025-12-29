import { describe, expect, test } from "@jest/globals";
import { theme } from "../../src/frontend/theme";
import { uiRadii } from "../../src/frontend/uiTokens";

describe("theme", () => {
  test("defines brand and accent palettes", () => {
    expect(theme.colors.brand).toHaveLength(10);
    expect(theme.colors.accent).toHaveLength(10);
  });

  test("sets component default radii", () => {
    expect(theme.components?.Button?.defaultProps?.radius).toBe(
      uiRadii.control,
    );
    expect(theme.components?.Card?.defaultProps?.radius).toBe(uiRadii.surface);
    expect(theme.components?.Badge?.defaultProps?.radius).toBe(uiRadii.badge);
  });
});
