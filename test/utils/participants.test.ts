import { describe, expect, test } from "@jest/globals";
import type { Guild, GuildMember, User } from "discord.js";
import {
  buildParticipantSnapshot,
  formatParticipantLabel,
  fromMember,
  fromUser,
  getParticipantPreferredName,
  getParticipantUsername,
} from "../../src/utils/participants";

const buildMember = (overrides?: Partial<GuildMember>): GuildMember => {
  const base = {
    user: {
      id: "user-1",
      username: "alpha",
      globalName: "Alpha",
      tag: "alpha#0001",
    },
    nickname: "Al",
  };
  return { ...base, ...overrides } as unknown as GuildMember;
};

const buildUser = (overrides?: Partial<User>): User => {
  const base = {
    id: "user-2",
    username: "beta",
    globalName: "Beta",
    tag: "beta#0002",
  };
  return { ...base, ...overrides } as unknown as User;
};

describe("participant helpers", () => {
  test("builds participant snapshot from cached member", async () => {
    const member = buildMember();
    const guild = {
      members: {
        cache: new Map([["user-1", member]]),
        fetch: jest.fn(),
      },
      client: { users: { cache: new Map() } },
    } as unknown as Guild;

    const snapshot = await buildParticipantSnapshot(guild, "user-1");
    expect(snapshot).toEqual(fromMember(member));
  });

  test("builds participant snapshot from fetched member when cache misses", async () => {
    const baseMember = buildMember();
    const member = buildMember({
      user: { ...baseMember.user, id: "user-9", username: "gamma" },
    });
    const guild = {
      members: {
        cache: new Map(),
        fetch: jest.fn().mockResolvedValue(member),
      },
      client: { users: { cache: new Map() } },
    } as unknown as Guild;

    const snapshot = await buildParticipantSnapshot(guild, "user-9");
    expect(snapshot).toEqual(fromMember(member));
  });

  test("falls back to cached user when member fetch fails", async () => {
    const user = buildUser({ id: "user-2" });
    const guild = {
      members: {
        cache: new Map(),
        fetch: jest.fn().mockRejectedValue(new Error("missing member")),
      },
      client: { users: { cache: new Map([["user-2", user]]) } },
    } as unknown as Guild;

    const snapshot = await buildParticipantSnapshot(guild, "user-2");
    expect(snapshot).toEqual(fromUser(user));
  });

  test("returns undefined when no member or user is found", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const guild = {
      members: {
        cache: new Map(),
        fetch: jest.fn().mockRejectedValue(new Error("missing member")),
      },
      client: { users: { cache: new Map() } },
    } as unknown as Guild;

    const snapshot = await buildParticipantSnapshot(guild, "user-3");
    expect(snapshot).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("resolves preferred display names in priority order", () => {
    expect(
      getParticipantPreferredName({
        id: "1",
        username: "alpha",
        displayName: "Alpha",
        serverNickname: "Al",
        tag: "alpha#0001",
      }),
    ).toBe("Al");

    expect(
      getParticipantPreferredName({
        id: "1",
        username: "alpha",
        displayName: "Alpha",
        tag: "alpha#0001",
      }),
    ).toBe("Alpha");
  });

  test("formats labels with usernames when requested", () => {
    const label = formatParticipantLabel(
      {
        id: "1",
        username: "alpha",
        displayName: "Alpha Prime",
        tag: "alpha#0001",
      },
      { includeUsername: true },
    );
    expect(label).toBe("Alpha Prime (@alpha)");

    const handleOnly = formatParticipantLabel(
      { id: "1", username: "alpha", tag: "alpha#0001" },
      { includeUsername: true },
    );
    expect(handleOnly).toBe("alpha");

    const matchingName = formatParticipantLabel(
      {
        id: "1",
        username: "alpha",
        displayName: "Alpha",
        tag: "alpha#0001",
      },
      { includeUsername: true },
    );
    expect(matchingName).toBe("Alpha");

    const fallbackHandle = formatParticipantLabel(undefined, {
      includeUsername: true,
      fallbackUsername: "alpha",
    });
    expect(fallbackHandle).toBe("@alpha");
  });

  test("falls back to username or provided defaults", () => {
    expect(getParticipantUsername(undefined, "fallback")).toBe("fallback");
    expect(formatParticipantLabel(undefined, { fallbackName: "Mystery" })).toBe(
      "Mystery",
    );
  });
});
