import {
  GuildMember,
  PermissionsBitField,
  TextChannel,
  VoiceBasedChannel,
} from "discord.js";

/**
 * Checks if the bot has permission to join a voice channel
 * @param voiceChannel - The voice channel to check
 * @param botMember - The bot's guild member object
 * @returns true if bot can join, false otherwise
 */
export function canBotJoinVoiceChannel(
  voiceChannel: VoiceBasedChannel,
  botMember: GuildMember,
): boolean {
  const permissions = voiceChannel.permissionsFor(botMember);
  return !!(
    permissions &&
    permissions.has(PermissionsBitField.Flags.ViewChannel) &&
    permissions.has(PermissionsBitField.Flags.Connect)
  );
}

/**
 * Checks if the bot has permission to send messages in a text channel
 * @param textChannel - The text channel to check
 * @param botMember - The bot's guild member object
 * @returns true if bot can send messages, false otherwise
 */
export function canBotSendMessages(
  textChannel: TextChannel,
  botMember: GuildMember,
): boolean {
  const permissions = textChannel.permissionsFor(botMember);
  return !!(
    permissions &&
    permissions.has(PermissionsBitField.Flags.SendMessages) &&
    permissions.has(PermissionsBitField.Flags.ViewChannel)
  );
}

export interface PermissionCheckResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Performs a comprehensive permission check for both voice and text channels
 * @param voiceChannel - The voice channel to check
 * @param textChannel - The text channel to check
 * @param botMember - The bot's guild member object
 * @returns Result object with success status and optional error message
 */
export function checkBotPermissions(
  voiceChannel: VoiceBasedChannel,
  textChannel: TextChannel,
  botMember: GuildMember,
): PermissionCheckResult {
  if (!canBotJoinVoiceChannel(voiceChannel, botMember)) {
    return {
      success: false,
      errorMessage: `I do not have permission to join **${voiceChannel.name}**.`,
    };
  }

  if (!canBotSendMessages(textChannel, botMember)) {
    return {
      success: false,
      errorMessage: `I do not have permission to send messages in **${textChannel.name}**.`,
    };
  }

  return { success: true };
}
