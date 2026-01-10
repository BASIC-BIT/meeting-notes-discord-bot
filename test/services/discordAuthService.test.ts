import { jest } from "@jest/globals";
import type { AuthedProfile } from "../../src/trpc/context";
import {
  buildDiscordAuthProfile,
  ensureDiscordAccessToken,
} from "../../src/services/discordAuthService";

const makeProfile = (overrides: Partial<AuthedProfile> = {}): AuthedProfile =>
  ({
    id: "user-1",
    username: "TestUser",
    ...overrides,
  }) as AuthedProfile;

const mockFetchResponse = (value: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: value.ok,
    status: value.status,
    json: value.json ?? (async () => ({})),
    text: value.text ?? (async () => ""),
  }) as unknown as typeof fetch;
};

describe("buildDiscordAuthProfile", () => {
  it("uses expires_in when provided", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const profile = makeProfile();

    const result = buildDiscordAuthProfile(
      profile,
      "access-token",
      "refresh-token",
      120,
    );

    expect(result.tokenExpiresAt).toBe(1_000_000 + 120 * 1000);
    nowSpy.mockRestore();
  });

  it("falls back to the default expiry when expires_in is missing", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(2_000_000);
    const profile = makeProfile();

    const result = buildDiscordAuthProfile(
      profile,
      "access-token",
      "refresh-token",
    );

    const defaultExpiryMs = 7 * 24 * 60 * 60 * 1000;
    expect(result.tokenExpiresAt).toBe(2_000_000 + defaultExpiryMs);
    nowSpy.mockRestore();
  });
});

describe("ensureDiscordAccessToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes expired tokens and updates the profile", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(3_000_000);
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify",
      }),
    });

    const user = makeProfile({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      tokenExpiresAt: 1_000,
    });

    const result = await ensureDiscordAccessToken(user);

    expect(result.refreshed).toBe(true);
    expect(result.shouldLogout).toBe(false);
    expect(result.user.accessToken).toBe("new-access");
    expect(result.user.refreshToken).toBe("new-refresh");
    expect(result.user.tokenExpiresAt).toBe(3_000_000 + 3600 * 1000);
    nowSpy.mockRestore();
  });

  it("flags invalid refresh tokens for logout", async () => {
    mockFetchResponse({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid refresh token",
        }),
    });

    const user = makeProfile({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      tokenExpiresAt: 1,
    });

    const result = await ensureDiscordAccessToken(user);

    expect(result.refreshed).toBe(false);
    expect(result.shouldLogout).toBe(true);
    expect(result.user).toBe(user);
    expect(result.error?.status).toBe(400);
    expect(result.error?.error).toBe("invalid_grant");
  });
});
