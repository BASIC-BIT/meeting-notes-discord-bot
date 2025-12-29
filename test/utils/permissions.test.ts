import { describe, expect, test } from "@jest/globals";
import type { GuildMember, TextChannel, VoiceBasedChannel } from "discord.js";
import { PermissionsBitField } from "discord.js";
import {
  canBotJoinVoiceChannel,
  canBotSendMessages,
  checkBotPermissions,
} from "../../src/utils/permissions";

const buildPermissions = (flags: Array<bigint>) => ({
  has: (flag: bigint) => flags.includes(flag),
});

describe("permission helpers", () => {
  const botMember = {} as GuildMember;

  test("validates voice channel permissions", () => {
    const voiceChannel = {
      name: "Voice",
      permissionsFor: () =>
        buildPermissions([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
        ]),
    } as unknown as VoiceBasedChannel;

    expect(canBotJoinVoiceChannel(voiceChannel, botMember)).toBe(true);
  });

  test("detects missing voice permissions", () => {
    const voiceChannel = {
      name: "Voice",
      permissionsFor: () =>
        buildPermissions([PermissionsBitField.Flags.ViewChannel]),
    } as unknown as VoiceBasedChannel;

    expect(canBotJoinVoiceChannel(voiceChannel, botMember)).toBe(false);
  });

  test("validates text channel permissions", () => {
    const textChannel = {
      name: "Text",
      permissionsFor: () =>
        buildPermissions([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ]),
    } as unknown as TextChannel;

    expect(canBotSendMessages(textChannel, botMember)).toBe(true);
  });

  test("returns descriptive errors for permission checks", () => {
    const voiceChannel = {
      name: "Voice",
      permissionsFor: () => buildPermissions([]),
    } as unknown as VoiceBasedChannel;
    const textChannel = {
      name: "Text",
      permissionsFor: () =>
        buildPermissions([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ]),
    } as unknown as TextChannel;

    const voiceFailure = checkBotPermissions(
      voiceChannel,
      textChannel,
      botMember,
    );
    expect(voiceFailure.success).toBe(false);
    expect(voiceFailure.errorMessage).toContain("Voice");

    const textFailure = checkBotPermissions(
      {
        name: "Voice",
        permissionsFor: () =>
          buildPermissions([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
          ]),
      } as unknown as VoiceBasedChannel,
      {
        name: "Text",
        permissionsFor: () => buildPermissions([]),
      } as unknown as TextChannel,
      botMember,
    );
    expect(textFailure.success).toBe(false);
    expect(textFailure.errorMessage).toContain("Text");
  });
});
