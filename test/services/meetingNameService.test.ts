import { beforeEach, expect, test } from "@jest/globals";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import {
  isMeetingNameAutoSynced,
  listRecentMeetingNamesForPrompt,
  normalizeMeetingName,
  resolveMeetingNameFromSummary,
  resolveUniqueMeetingName,
} from "../../src/services/meetingNameService";

beforeEach(() => {
  resetMockStore();
});

test("normalizeMeetingName trims, collapses whitespace, and validates", () => {
  expect(normalizeMeetingName("  Sprint   planning ")).toBe("Sprint planning");
  expect(
    normalizeMeetingName("Too many words in this meeting name"),
  ).toBeUndefined();
  expect(normalizeMeetingName("Weekly sync!")).toBeUndefined();
});

test("resolveUniqueMeetingName appends a suffix on collisions", async () => {
  const store = getMockStore();
  const guildId = store.userGuilds[0]!.id;
  const meetings = store.meetingHistoryByGuild.get(guildId) ?? [];
  meetings[0] = { ...meetings[0]!, meetingName: "Sprint planning" };
  store.meetingHistoryByGuild.set(guildId, meetings);

  const resolved = await resolveUniqueMeetingName({
    guildId,
    desiredName: "Sprint planning",
  });

  expect(resolved).toBe("Sprint planning 2");
});

test("resolveUniqueMeetingName uses summary labels for collisions", async () => {
  const store = getMockStore();
  const guildId = store.userGuilds[0]!.id;
  const meetings = store.meetingHistoryByGuild.get(guildId) ?? [];
  meetings[0] = { ...meetings[0]!, summaryLabel: "Weekly sync" };
  store.meetingHistoryByGuild.set(guildId, meetings);

  const resolved = await resolveUniqueMeetingName({
    guildId,
    desiredName: "Weekly sync",
  });

  expect(resolved).toBe("Weekly sync 2");
});

test("resolveMeetingNameFromSummary returns undefined for invalid labels", async () => {
  const store = getMockStore();
  const guildId = store.userGuilds[0]!.id;
  const resolved = await resolveMeetingNameFromSummary({
    guildId,
    summaryLabel: "Too many words in this label",
  });
  expect(resolved).toBeUndefined();
});

test("resolveMeetingNameFromSummary de-duplicates valid labels", async () => {
  const store = getMockStore();
  const guildId = store.userGuilds[0]!.id;
  const meetings = store.meetingHistoryByGuild.get(guildId) ?? [];
  meetings[0] = { ...meetings[0]!, meetingName: "Sprint planning" };
  store.meetingHistoryByGuild.set(guildId, meetings);

  const resolved = await resolveMeetingNameFromSummary({
    guildId,
    summaryLabel: "Sprint planning",
  });

  expect(resolved).toBe("Sprint planning 2");
});

test("listRecentMeetingNamesForPrompt returns unique names", async () => {
  const store = getMockStore();
  const guildId = store.userGuilds[0]!.id;
  const meetings = store.meetingHistoryByGuild.get(guildId) ?? [];
  meetings[0] = { ...meetings[0]!, meetingName: "Sprint planning" };
  meetings[1] = { ...meetings[1]!, meetingName: "Sprint planning" };
  meetings[2] = { ...meetings[2]!, summaryLabel: "Weekly sync" };
  store.meetingHistoryByGuild.set(guildId, meetings);

  const result = await listRecentMeetingNamesForPrompt({ guildId, limit: 5 });
  expect(result).toContain("- Sprint planning");
  expect(result).toContain("- Weekly sync");
  expect((result.match(/Sprint planning/g) ?? []).length).toBe(1);
});

test("isMeetingNameAutoSynced detects default sync state", () => {
  expect(isMeetingNameAutoSynced(undefined, "Weekly sync")).toBe(true);
  expect(isMeetingNameAutoSynced("Weekly sync", "Weekly sync")).toBe(true);
  expect(isMeetingNameAutoSynced("Custom name", "Weekly sync")).toBe(false);
});
