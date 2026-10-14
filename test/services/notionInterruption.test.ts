/** @jest-environment node */
import { config } from "../../src/services/configService";
import {
  getNotionIntegrationRepository,
  resetNotionIntegrationMemoryRepository,
} from "../../src/repositories/notionIntegrationRepository";
import {
  saveNotionConnectionFromCode,
  setNotionFetchForTests,
  resetNotionFetchForTests,
} from "../../src/services/notionService";
import {
  maybeAutoExportCompletedMeeting,
  maybeAutoSyncMeetingNotes,
} from "../../src/services/notionAutomationService";
import { UnresolvedNotionMutation } from "../../src/services/notionOperationLifetime";
import type { MeetingHistory } from "../../src/types/db";
const meeting = {
  guildId: "synthetic-notion",
  channelId_timestamp: "synthetic#2026-01-01",
  meetingId: "synthetic-notion",
  channelId: "synthetic",
  timestamp: "2026-01-01T00:00:00Z",
  notes: "Synthetic notes",
  notesVersion: 2,
  participants: [],
  duration: 1,
  transcribeMeeting: true,
  generateNotes: true,
} satisfies MeetingHistory;
async function fixture() {
  resetNotionIntegrationMemoryRepository();
  jest.spyOn(config.notion, "enabled", "get").mockReturnValue(true);
  const fetch = jest.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        access_token: "synthetic",
        refresh_token: "synthetic",
        bot_id: "synthetic",
        workspace_id: "synthetic",
        workspace_name: "Synthetic",
        workspace_icon: null,
      }),
    ),
  );
  setNotionFetchForTests(fetch);
  await saveNotionConnectionFromCode({
    userId: "synthetic",
    code: "synthetic",
  });
  const repository = getNotionIntegrationRepository();
  await repository.writeAutomationConfig({
    guildId: meeting.guildId,
    ownerUserId: "synthetic",
    workspaceId: "synthetic",
    destinationType: "page",
    destinationPageId: "synthetic-parent",
    autoExportEnabled: true,
    createdAt: "now",
    updatedAt: "now",
  });
  return {
    fetch,
    repository,
    key: { guildId: meeting.guildId, meetingId: meeting.channelId_timestamp },
  };
}
afterEach(() => {
  resetNotionFetchForTests();
  jest.restoreAllMocks();
});

test("unknown submitted create retains the permanent reservation and prevents automatic duplicate create", async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  let reject!: (error: Error) => void;
  f.fetch.mockImplementationOnce(() => {
    entered();
    return new Promise((_done, failed) => {
      reject = failed;
    });
  });
  const controller = new AbortController();
  const operation = maybeAutoExportCompletedMeeting(meeting, controller.signal);
  const outcome = operation.catch((error: unknown) => error);
  await started;
  expect(f.fetch.mock.calls[1][1].signal).toBe(controller.signal);
  reject(new Error("synthetic lost response"));
  expect(await outcome).toBeInstanceOf(UnresolvedNotionMutation);
  expect(await f.repository.getAutomationMeetingExport(f.key)).toBeUndefined();
  await maybeAutoExportCompletedMeeting(meeting, new AbortController().signal);
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(
    await f.repository.getAutomationConfig(meeting.guildId),
  ).not.toHaveProperty("lastError");
});

test("pre-dispatch cancellation after held connection lookup never sends a page mutation", async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const original = f.repository.getConnection;
  jest
    .spyOn(f.repository, "getConnection")
    .mockImplementationOnce(async (id) => {
      entered();
      await new Promise<void>((done) => {
        release = done;
      });
      return original(id);
    });
  const controller = new AbortController();
  const operation = maybeAutoExportCompletedMeeting(meeting, controller.signal);
  const outcome = operation.catch((error: unknown) => error);
  await started;
  controller.abort(new Error("synthetic stop"));
  release();
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test("unknown fixed-page update preserves the acknowledged export row", async () => {
  const f = await fixture();
  const existing = {
    guildId: meeting.guildId,
    channelId_timestamp: meeting.channelId_timestamp,
    ownerUserId: "synthetic",
    notionPageId: "synthetic-existing-page",
    exportedNotesVersion: 1,
    status: "exported" as const,
    attemptCount: 1,
    lastAttemptAt: "previous",
  };
  await f.repository.writeAutomationMeetingExport(existing);
  f.fetch.mockRejectedValueOnce(new Error("synthetic lost update response"));
  await expect(
    maybeAutoSyncMeetingNotes(meeting, new AbortController().signal),
  ).rejects.toBeInstanceOf(UnresolvedNotionMutation);
  expect(await f.repository.getAutomationMeetingExport(f.key)).toEqual(
    existing,
  );
  expect(f.fetch.mock.calls[1][0]).toContain(
    "synthetic-existing-page/markdown",
  );
});
