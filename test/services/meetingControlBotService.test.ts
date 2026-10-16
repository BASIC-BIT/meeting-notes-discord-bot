/** @jest-environment node */
import {
  ChannelType,
  Client,
  ClientUser,
  Guild,
  GuildMember,
  Message,
  PermissionFlagsBits,
  PermissionsBitField,
  TextChannel,
  User,
  VoiceChannel,
  VoiceState,
} from "discord.js";
import { interruptOwnedMeeting } from "../../src/services/ownedMeetingInterruption";
import { resolveServerMeetingArtifactAccess } from "../../src/services/meetingArtifactAccessService";
import { CONFIG_KEYS } from "../../src/config/keys";
import { initializeMeeting } from "../../src/meetings";
import { getGlobalConfigValues } from "../../src/services/appConfigService";
import { listConfigOverridesForScope } from "../../src/services/configOverridesService";
import { executeMeetingControlCommand } from "../../src/services/meetingControlBotService";
import {
  getGuildLimits,
  getLimitsForTier,
} from "../../src/services/subscriptionService";
import { checkBotPermissions } from "../../src/utils/permissions";
import {
  MEETING_CONTROL_COMMAND_TYPES,
  type MeetingControlCommand,
} from "../../src/types/meetingControl";
import type { MeetingData } from "../../src/types/meeting-data";

jest.mock("../../src/meetings", () => ({
  hasMeeting: jest.fn(() => false),
  getMeeting: jest.fn(),
  deleteMeeting: jest.fn(),
  initializeMeeting: jest.fn(),
}));
jest.mock("../../src/commands/endMeeting", () => ({
  handleEndMeetingOther: jest.fn(),
  persistExplicitMeetingStop: jest.fn(),
}));
jest.mock("../../src/services/meetingVoiceSettingsService", () => ({
  resolveMeetingVoiceSettings: jest.fn(async () => ({})),
}));
jest.mock("../../src/services/meetingArtifactAccessService", () => ({
  resolveServerMeetingArtifactAccess: jest.fn(async () => ({
    transcriptAccessEnabled: false,
  })),
}));
jest.mock("../../src/services/activeMeetingLeaseService", () => ({
  getActiveMeetingLeaseForGuild: jest.fn(async () => undefined),
}));
jest.mock("../../src/services/subscriptionService", () => ({
  ...jest.requireActual("../../src/services/subscriptionService"),
  getGuildLimits: jest.fn(),
}));
jest.mock("../../src/utils/permissions", () => ({
  checkBotPermissions: jest.fn(),
}));
jest.mock("../../src/services/appConfigService", () => ({
  getGlobalConfigValues: jest.fn(),
}));
jest.mock("../../src/services/configOverridesService", () => ({
  listConfigOverridesForScope: jest.fn(),
}));

jest.mock("../../src/services/ownedMeetingInterruption", () => ({
  interruptOwnedMeeting: jest.fn(async () => ({ kind: "unresolved" })),
}));

const client = new Client({ intents: [] });
const guild: Guild = Reflect.construct(Guild, [client, { id: "guild-1" }]);
const creator: User = Reflect.construct(User, [
  client,
  { id: "user-1", username: "Starter" },
]);
const bot: ClientUser = Reflect.construct(ClientUser, [
  client,
  { id: "bot-1", username: "Chronote" },
]);
client.user = bot;
const member: GuildMember = Reflect.construct(GuildMember, [
  client,
  { user: { id: creator.id, username: creator.username }, roles: [] },
  guild,
]);
const botMember: GuildMember = Reflect.construct(GuildMember, [
  client,
  { user: { id: bot.id, username: bot.username }, roles: [] },
  guild,
]);
const voice: VoiceChannel = Reflect.construct(VoiceChannel, [
  guild,
  { id: "voice-1", type: ChannelType.GuildVoice, name: "Voice" },
  guild.client,
]);
const notes: TextChannel = Reflect.construct(TextChannel, [
  guild,
  { id: "voice-notes", type: ChannelType.GuildText, name: "private-notes" },
  guild.client,
]);
let serverDestination: string | undefined;
let voiceDestination: string | undefined;
let fetchChannel: jest.SpyInstance;
let send: jest.SpyInstance;
const command = (textChannelId?: string): MeetingControlCommand => ({
  requestId: "request-1",
  commandType: MEETING_CONTROL_COMMAND_TYPES.START_MEETING,
  queueStatus: "pending",
  userId: creator.id,
  input: { serverId: guild.id, textChannelId },
  createdAt: "2026-10-16T00:00:00Z",
  updatedAt: "2026-10-16T00:00:00Z",
  expiresAt: 1,
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  serverDestination = "server-notes";
  voiceDestination = "voice-notes";
  client.guilds.cache.set(guild.id, guild);
  guild.channels.cache.set(voice.id, voice);
  guild.members.cache.set(creator.id, member);
  guild.members.cache.set(bot.id, botMember);
  guild.voiceStates.cache.set(
    creator.id,
    Reflect.construct(VoiceState, [
      guild,
      { user_id: creator.id, channel_id: voice.id },
    ]),
  );
  jest.spyOn(client.users, "fetch").mockResolvedValue(creator);
  fetchChannel = jest.spyOn(guild.channels, "fetch").mockResolvedValue(notes);
  send = jest.spyOn(notes, "send").mockResolvedValue(
    Reflect.construct(Message, [
      client,
      {
        id: "message-1",
        channel_id: notes.id,
        author: { id: bot.id, username: bot.username },
        timestamp: "2026-10-16T00:00:00Z",
      },
    ]),
  );
  jest
    .spyOn(notes, "permissionsFor")
    .mockReturnValue(
      new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]),
    );
  jest.mocked(checkBotPermissions).mockReturnValue({ success: true });
  jest.mocked(getGlobalConfigValues).mockResolvedValue({});
  jest
    .mocked(listConfigOverridesForScope)
    .mockImplementation(async (context) => {
      const value =
        context.scope === "channel" ? voiceDestination : serverDestination;
      return value === undefined
        ? []
        : [
            {
              scopeId: `${context.scope}#guild-1`,
              configKey: CONFIG_KEYS.notes.channelId,
              value,
              updatedAt: "2026-10-16T00:00:00Z",
              updatedBy: creator.id,
            },
          ];
    });
  jest.mocked(getGuildLimits).mockResolvedValue({
    limits: { ...getLimitsForTier("free"), maxMeetingMinutesRolling: 0 },
    subscription: {
      tier: "free",
      status: "active",
      source: "default",
      billingSource: "free",
      stripeTier: null,
      grantTier: null,
      activeGrant: null,
    },
  });
  jest.mocked(initializeMeeting).mockResolvedValue({
    guildId: guild.id,
    meetingId: "meeting-1",
    voiceChannel: voice,
    textChannel: notes,
    startTime: new Date("2026-10-16T00:00:00Z"),
  } as MeetingData);
});

test("omitted remote destination uses the current voice settings", async () => {
  const result = await executeMeetingControlCommand(client, command());
  expect(result).toEqual(
    expect.objectContaining({
      status: "started",
      textChannelId: "voice-notes",
    }),
  );
  expect(fetchChannel).toHaveBeenCalledWith("voice-notes");
  expect(initializeMeeting).toHaveBeenCalledWith(
    expect.objectContaining({
      textChannel: notes,
      startReason: "mcp",
      startTriggeredByUserId: creator.id,
    }),
  );
  expect(send).toHaveBeenCalledTimes(1);
});

test("an explicit remote destination keeps its existing validation and skips config", async () => {
  const result = await executeMeetingControlCommand(
    client,
    command("explicit-notes"),
  );
  expect(result).toEqual(expect.objectContaining({ status: "started" }));
  expect(fetchChannel).toHaveBeenCalledWith("explicit-notes");
  expect(getGlobalConfigValues).not.toHaveBeenCalled();
  expect(initializeMeeting).toHaveBeenCalled();
});

test("denied remote access does not initialize or disclose the hidden channel name", async () => {
  jest
    .spyOn(notes, "permissionsFor")
    .mockReturnValue(
      new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ]),
    );
  const error = await executeMeetingControlCommand(client, command()).catch(
    (failure: Error) => failure,
  );
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error("Expected access denial");
  expect(error.message).not.toContain("private-notes");
  expect(initializeMeeting).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("a bot permission denial prevents initialization", async () => {
  jest.mocked(checkBotPermissions).mockReturnValue({
    success: false,
    errorMessage: "Missing bot permissions.",
  });
  await expect(executeMeetingControlCommand(client, command())).rejects.toThrow(
    "Missing bot permissions",
  );
  expect(checkBotPermissions).toHaveBeenCalledWith(voice, notes, botMember);
  expect(initializeMeeting).not.toHaveBeenCalled();
});

test("unconfigured remote start does not initialize", async () => {
  serverDestination = undefined;
  voiceDestination = undefined;
  await expect(
    executeMeetingControlCommand(client, command()),
  ).rejects.toThrow();
  expect(initializeMeeting).not.toHaveBeenCalled();
  expect(fetchChannel).not.toHaveBeenCalled();
});

test("a missing configured remote destination never initializes", async () => {
  fetchChannel.mockResolvedValue(null);
  await expect(
    executeMeetingControlCommand(client, command()),
  ).rejects.toThrow();
  expect(initializeMeeting).not.toHaveBeenCalled();
});

test("remote uncertain publication preserves once without retrying", async () => {
  send.mockRejectedValueOnce(new Error("Discord send response timed out"));
  await expect(executeMeetingControlCommand(client, command())).rejects.toThrow(
    "timed out",
  );
  const meeting = await jest.mocked(initializeMeeting).mock.results[0].value;
  expect(interruptOwnedMeeting).toHaveBeenCalledTimes(1);
  expect(interruptOwnedMeeting).toHaveBeenCalledWith(meeting, {
    reason: "processing_failure",
    deadline: expect.any(Number),
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(meeting.startMessageId).toBeUndefined();
});

test("remote ownership lost after initialization preserves before publication", async () => {
  let checks = 0;
  await expect(
    executeMeetingControlCommand(client, command(), async () => {
      if (++checks === 4) throw new Error("claim lost");
    }),
  ).rejects.toThrow("claim lost");
  expect(initializeMeeting).toHaveBeenCalledTimes(1);
  expect(interruptOwnedMeeting).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

test("remote artifact lookup failure never initializes", async () => {
  jest
    .mocked(resolveServerMeetingArtifactAccess)
    .mockRejectedValueOnce(new Error("lookup failed"));
  await expect(executeMeetingControlCommand(client, command())).rejects.toThrow(
    "lookup failed",
  );
  expect(initializeMeeting).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
