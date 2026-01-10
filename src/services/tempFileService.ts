import path from "node:path";
import { mkdirSync, promises as fs } from "node:fs";
import type { MeetingData } from "../types/meeting-data";
import { config } from "./configService";

const BASE_TEMP_DIR = path.resolve(config.paths.meetingTempDir);

export function getTempBaseDir(): string {
  return BASE_TEMP_DIR;
}

export async function ensureTempBaseDir(): Promise<string> {
  await fs.mkdir(BASE_TEMP_DIR, { recursive: true });
  return BASE_TEMP_DIR;
}

export function getMeetingTempDir(meeting: MeetingData): string {
  return path.join(BASE_TEMP_DIR, "m", meeting.meetingId);
}

export async function ensureMeetingTempDir(
  meeting: MeetingData,
): Promise<string> {
  const dir = getMeetingTempDir(meeting);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function ensureMeetingTempDirSync(meeting: MeetingData): string {
  const dir = getMeetingTempDir(meeting);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function safeRemove(dir: string, label: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to clean ${label} temp directory: ${dir}`, error);
  }
}

export async function cleanupTempBaseDir(): Promise<void> {
  await safeRemove(BASE_TEMP_DIR, "base");
}

export async function cleanupMeetingTempDir(
  meeting: MeetingData,
): Promise<void> {
  await safeRemove(getMeetingTempDir(meeting), "meeting");
}
