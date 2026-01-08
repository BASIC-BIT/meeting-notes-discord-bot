import { describe, expect, test } from "@jest/globals";
import {
  buildAllowedRedirectOrigins,
  resolveSafeRedirect,
} from "../../src/services/oauthRedirectService";

describe("oauthRedirectService", () => {
  test("allows relative redirects", () => {
    const allowed = buildAllowedRedirectOrigins("https://app.example.com", []);
    expect(
      resolveSafeRedirect("/portal/select-server?promo=SAVE20", allowed),
    ).toBe("/portal/select-server?promo=SAVE20");
  });

  test("blocks protocol-relative redirects", () => {
    const allowed = buildAllowedRedirectOrigins("https://app.example.com", []);
    expect(resolveSafeRedirect("//evil.com/portal", allowed)).toBeUndefined();
  });

  test("allows redirects to approved origins", () => {
    const allowed = buildAllowedRedirectOrigins("https://app.example.com", [
      "http://localhost:5173",
    ]);
    const target =
      "https://app.example.com/portal/server/g1/library?meetingId=meeting-1";
    expect(resolveSafeRedirect(target, allowed)).toBe(target);
  });

  test("rejects redirects to unknown origins", () => {
    const allowed = buildAllowedRedirectOrigins("https://app.example.com", []);
    expect(
      resolveSafeRedirect("https://evil.example.com/portal", allowed),
    ).toBeUndefined();
  });
});
