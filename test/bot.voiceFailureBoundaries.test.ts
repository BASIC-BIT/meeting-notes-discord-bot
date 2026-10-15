/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";

// Execute the production registrations without starting Discord or importing cloud clients.
function loadVoiceBoundary(rejectSubscription: () => Promise<void>) {
  const file = path.join(__dirname, "../src/bot.ts");
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const functions = source.statements.filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ["setupBot", "handleVoiceStateUpdate", "handleUserJoin"].includes(
        node.name?.text ?? "",
      ),
  );
  expect(functions).toHaveLength(3);
  const client = Object.assign(new EventEmitter(), {
    user: { id: "synthetic-bot" },
    login: jest.fn().mockResolvedValue(undefined),
  });
  const meeting = {
    meetingId: "synthetic-meeting",
    voiceChannel: { id: "synthetic-voice" },
    participants: new Map(),
    attendance: new Set(),
    chatLog: [],
    audioData: {},
    finishing: false,
  };
  const warn = jest.fn();
  const context = vm.createContext({
    client,
    TOKEN: "synthetic-token",
    CLIENT_ID: "synthetic-client",
    Events: { ClientReady: "ready" },
    console: { log: jest.fn(), warn, error: jest.fn() },
    setDiscordClient: jest.fn(),
    startMeetingControlCommandWorker: jest.fn(),
    setupApplicationCommands: jest.fn(),
    recordSuppressionVoiceState: jest.fn(),
    getMeeting: () => meeting,
    isMeetingCollectingEvents: () => true,
    fromMember: () => ({ id: "synthetic-user" }),
    formatParticipantLabel: () => "Synthetic",
    formatUserMention: () => "Synthetic",
    subscribeToUserVoice: rejectSubscription,
  });
  vm.runInContext(
    ts.transpileModule(
      functions
        .map((node) => node.getText(source).replace(/^export /, ""))
        .join("\n") + "\nsetupBot();",
      {
        compilerOptions: {
          module: ts.ModuleKind.None,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    context,
  );
  client.emit("ready");
  return { client, warn, meeting };
}

test("the registered voice-state boundary consumes a subscription rejection once with sanitized metadata", async () => {
  const { client, warn, meeting } = loadVoiceBoundary(async () => {
    throw new Error("private participant and error details");
  });
  const oldState = {
    guild: { id: "synthetic-guild" },
    channel: null,
    channelId: null,
  };
  const newState = {
    guild: oldState.guild,
    channel: {},
    channelId: "synthetic-voice",
    member: { user: { id: "synthetic-user", username: "private name" } },
  };
  client.emit("voiceStateUpdate", oldState, newState);
  await new Promise((resolve) => setImmediate(resolve));
  expect(warn.mock.calls).toEqual([
    [
      "Voice state operation failed:",
      { stage: "voice-state-update", meetingId: "synthetic-meeting" },
    ],
  ]);
  expect(meeting.participants.has("synthetic-user")).toBe(true);
});

test("the registered voice-state boundary keeps a successful subscription silent", async () => {
  const { client, warn } = loadVoiceBoundary(async () => {});
  const oldState = {
    guild: { id: "synthetic-guild" },
    channel: null,
    channelId: null,
  };
  client.emit("voiceStateUpdate", oldState, {
    ...oldState,
    channel: {},
    channelId: "synthetic-voice",
    member: { user: { id: "synthetic-user" } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(warn).not.toHaveBeenCalled();
});
