import { describe, expect, it } from "@jest/globals";
import {
  getDiscordOpenUrl,
  isMobileUserAgent,
  resolveDeviceKind,
} from "../../src/frontend/utils/discordLinks";

describe("isMobileUserAgent", () => {
  it("detects mobile user agents", () => {
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ),
    ).toBe(true);
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36",
      ),
    ).toBe(true);
  });

  it("returns false for desktop user agents", () => {
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ),
    ).toBe(false);
  });
});

describe("resolveDeviceKind", () => {
  it("respects forceDevice", () => {
    expect(resolveDeviceKind({ forceDevice: "mobile" })).toBe("mobile");
    expect(resolveDeviceKind({ forceDevice: "desktop" })).toBe("desktop");
  });

  it("prefers userAgentData mobile flag", () => {
    expect(resolveDeviceKind({ userAgentDataMobile: true })).toBe("mobile");
    expect(
      resolveDeviceKind({ userAgentDataMobile: false, userAgent: "" }),
    ).toBe("desktop");
  });
});

describe("getDiscordOpenUrl", () => {
  const discordLink =
    "https://discord.com/channels/123/456/789?jump=1#fragment";

  it("keeps https links on mobile", () => {
    expect(getDiscordOpenUrl(discordLink, { forceDevice: "mobile" })).toBe(
      discordLink,
    );
  });

  it("rewrites discord channel links for desktop", () => {
    expect(getDiscordOpenUrl(discordLink, { forceDevice: "desktop" })).toBe(
      "discord://discord.com/channels/123/456/789?jump=1#fragment",
    );
  });

  it("leaves non-discord links untouched", () => {
    expect(
      getDiscordOpenUrl("https://example.com", { forceDevice: "desktop" }),
    ).toBe("https://example.com");
  });

  it("leaves non-channel discord links untouched", () => {
    expect(
      getDiscordOpenUrl("https://discord.com/app", { forceDevice: "desktop" }),
    ).toBe("https://discord.com/app");
  });
});
