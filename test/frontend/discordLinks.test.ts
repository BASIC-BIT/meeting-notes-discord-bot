import { describe, expect, test } from "@jest/globals";
import {
  getDiscordOpenUrl,
  resolveDeviceKind,
} from "../../src/frontend/utils/discordLinks";

describe("discord links", () => {
  test("resolveDeviceKind honors explicit and user agent signals", () => {
    expect(resolveDeviceKind({ forceDevice: "mobile" })).toBe("mobile");
    expect(resolveDeviceKind({ userAgentDataMobile: true })).toBe("mobile");
    expect(
      resolveDeviceKind({
        userAgentDataMobile: false,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe("desktop");
    expect(
      resolveDeviceKind({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
      }),
    ).toBe("mobile");
  });

  test("getDiscordOpenUrl builds desktop deep links for channels", () => {
    const href = "https://discord.com/channels/123/456";
    expect(getDiscordOpenUrl(href, { forceDevice: "desktop" })).toBe(
      "discord://discord.com/channels/123/456",
    );
    expect(getDiscordOpenUrl(href, { forceDevice: "mobile" })).toBe(href);
  });

  test("getDiscordOpenUrl returns original url for non-channel links", () => {
    const href = "https://example.com/channels/123/456";
    expect(getDiscordOpenUrl(href, { forceDevice: "desktop" })).toBe(href);
    expect(
      getDiscordOpenUrl("https://discord.com/app", { forceDevice: "desktop" }),
    ).toBe("https://discord.com/app");
    const deepLink = "discord://discord.com/channels/123/456";
    expect(getDiscordOpenUrl(deepLink, { forceDevice: "desktop" })).toBe(
      deepLink,
    );
  });
});
