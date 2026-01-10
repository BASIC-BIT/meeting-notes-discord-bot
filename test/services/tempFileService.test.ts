import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MeetingData } from "../../src/types/meeting-data";

const buildMeeting = (): MeetingData =>
  ({
    guildId: "guild-1",
    channelId: "channel-1",
    meetingId: "meeting-1",
  }) as MeetingData;

const loadService = async (baseDir: string) => {
  process.env.MEETING_TEMP_DIR = baseDir;
  jest.resetModules();
  return await import("../../src/services/tempFileService");
};

describe("tempFileService", () => {
  const originalEnv = process.env.MEETING_TEMP_DIR;

  afterEach(() => {
    process.env.MEETING_TEMP_DIR = originalEnv;
    jest.resetModules();
  });

  it("creates and cleans meeting temp directories", async () => {
    const baseDir = path.join(os.tmpdir(), `chronote-test-${Date.now()}`);
    const service = await loadService(baseDir);
    const meeting = buildMeeting();

    const dir = await service.ensureMeetingTempDir(meeting);
    expect(dir).toBe(service.getMeetingTempDir(meeting));
    expect(fs.existsSync(dir)).toBe(true);

    await service.cleanupMeetingTempDir(meeting);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("cleans the base temp directory", async () => {
    const baseDir = path.join(os.tmpdir(), `chronote-test-${Date.now()}`);
    const service = await loadService(baseDir);

    const dir = await service.ensureTempBaseDir();
    expect(dir).toBe(service.getTempBaseDir());
    expect(fs.existsSync(dir)).toBe(true);

    await service.cleanupTempBaseDir();
    expect(fs.existsSync(dir)).toBe(false);
  });
});
