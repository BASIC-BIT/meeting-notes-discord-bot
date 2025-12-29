import { afterEach, expect, jest, test } from "@jest/globals";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerLiveMeetingRoutes } from "../../src/api/liveMeetings";
import { getMeeting } from "../../src/meetings";
import { ensureUserInGuild } from "../../src/services/guildAccessService";
import { ensureUserCanConnectChannel } from "../../src/services/discordPermissionsService";
import {
  buildLiveMeetingMeta,
  buildLiveMeetingSegments,
} from "../../src/services/liveMeetingService";
import type {
  LiveMeetingMeta,
  LiveMeetingSegment,
} from "../../src/types/liveMeeting";
import type { MeetingData } from "../../src/types/meeting-data";

jest.mock("../../src/meetings", () => ({
  getMeeting: jest.fn(),
}));
jest.mock("../../src/services/guildAccessService", () => ({
  ensureUserInGuild: jest.fn(),
}));
jest.mock("../../src/services/discordPermissionsService", () => ({
  ensureUserCanConnectChannel: jest.fn(),
}));
jest.mock("../../src/services/liveMeetingService", () => ({
  buildLiveMeetingMeta: jest.fn(),
  buildLiveMeetingSegments: jest.fn(),
}));

const mockedGetMeeting = getMeeting as jest.MockedFunction<typeof getMeeting>;
const mockedEnsureUserInGuild = ensureUserInGuild as jest.MockedFunction<
  typeof ensureUserInGuild
>;
const mockedEnsureUserCanConnectChannel =
  ensureUserCanConnectChannel as jest.MockedFunction<
    typeof ensureUserCanConnectChannel
  >;
const mockedBuildLiveMeetingMeta = buildLiveMeetingMeta as jest.MockedFunction<
  typeof buildLiveMeetingMeta
>;
const mockedBuildLiveMeetingSegments =
  buildLiveMeetingSegments as jest.MockedFunction<
    typeof buildLiveMeetingSegments
  >;

const makeMeeting = (overrides?: Partial<MeetingData>): MeetingData =>
  ({
    guildId: "guild-1",
    meetingId: "meeting-1",
    voiceChannel: { id: "voice-1", name: "General" },
    startTime: new Date("2025-01-01T00:00:00.000Z"),
    finished: false,
    ...overrides,
  }) as MeetingData;

const makeMeta = (overrides?: Partial<LiveMeetingMeta>): LiveMeetingMeta => ({
  guildId: "guild-1",
  meetingId: "meeting-1",
  channelId: "voice-1",
  channelName: "General",
  startedAt: "2025-01-01T00:00:00.000Z",
  isAutoRecording: false,
  status: "in_progress",
  attendees: [],
  ...overrides,
});

const makeSegment = (
  overrides?: Partial<LiveMeetingSegment>,
): LiveMeetingSegment => ({
  id: "segment-1",
  userId: "user-1",
  startedAt: "2025-01-01T00:00:01.000Z",
  text: "hello",
  source: "voice",
  ...overrides,
});

const createServer = (authenticated = true) => {
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = () => authenticated;
    if (authenticated) {
      req.user = { id: "user-1", accessToken: "token" };
    }
    req.session = {};
    next();
  });
  registerLiveMeetingRoutes(app);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const requestJson = async (url: string) =>
  new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = http.request(url, { method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    req.end();
  });

const requestSseInit = async (url: string) =>
  new Promise<{ statusCode: number; buffer: string }>((resolve, reject) => {
    let resolved = false;
    const req = http.request(
      url,
      { method: "GET", headers: { Accept: "text/event-stream" } },
      (res) => {
        let buffer = "";
        res.setEncoding("utf8");
        const finish = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          resolve({ statusCode: res.statusCode ?? 0, buffer });
        };
        res.on("data", (chunk) => {
          buffer += chunk;
          if (
            buffer.includes("event: init") &&
            buffer.includes("data:") &&
            buffer.includes("\n\n")
          ) {
            finish();
            res.destroy();
            req.destroy();
          }
        });
        res.on("end", finish);
      },
    );
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      req.destroy();
      reject(new Error("Timed out waiting for init event"));
    }, 2000);
    req.on("error", (err) => {
      if (resolved) return;
      clearTimeout(timeout);
      reject(err);
    });
    req.end();
  });

afterEach(() => {
  jest.resetAllMocks();
});

test("streams init payload for live meeting", async () => {
  const meeting = makeMeeting();
  mockedGetMeeting.mockReturnValue(meeting);
  mockedEnsureUserInGuild.mockResolvedValue(true);
  mockedEnsureUserCanConnectChannel.mockResolvedValue(true);
  mockedBuildLiveMeetingMeta.mockReturnValue(makeMeta());
  mockedBuildLiveMeetingSegments.mockReturnValue([makeSegment()]);

  const { server, baseUrl } = createServer(true);
  try {
    const response = await requestSseInit(
      `${baseUrl}/api/live/guild-1/meeting-1/stream`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.buffer).toContain("event: init");
    expect(response.buffer).toContain('"meetingId":"meeting-1"');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  expect(mockedEnsureUserInGuild).toHaveBeenCalledWith("token", "guild-1");
  expect(mockedEnsureUserCanConnectChannel).toHaveBeenCalledWith({
    guildId: "guild-1",
    channelId: "voice-1",
    userId: "user-1",
  });
});

test("returns 403 when user cannot connect to the voice channel", async () => {
  const meeting = makeMeeting();
  mockedGetMeeting.mockReturnValue(meeting);
  mockedEnsureUserInGuild.mockResolvedValue(true);
  mockedEnsureUserCanConnectChannel.mockResolvedValue(false);

  const { server, baseUrl } = createServer(true);
  try {
    const response = await requestJson(
      `${baseUrl}/api/live/guild-1/meeting-1/stream`,
    );
    expect(response.statusCode).toBe(403);
    const payload = JSON.parse(response.body) as { error?: string };
    expect(payload.error).toBe("Channel access required");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("returns 401 when unauthenticated", async () => {
  const { server, baseUrl } = createServer(false);
  try {
    const response = await requestJson(
      `${baseUrl}/api/live/guild-1/meeting-1/stream`,
    );
    expect(response.statusCode).toBe(401);
    const payload = JSON.parse(response.body) as { error?: string };
    expect(payload.error).toBe("Not authenticated");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
