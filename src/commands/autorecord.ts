import {
  ChatInputCommandInteraction,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
  TextChannel,
  VoiceBasedChannel,
} from "discord.js";
import {
  writeAutoRecordSetting,
  getAutoRecordSetting,
  getAllAutoRecordSettings,
  deleteAutoRecordSetting,
} from "../db";
import { AutoRecordSettings } from "../types/db";
import { parseTags } from "../utils/tags";

export async function handleAutoRecordCommand(
  interaction: ChatInputCommandInteraction,
) {
  const subcommand = interaction.options.getSubcommand();

  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check permissions
  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (
    !member ||
    !member.permissions.has(PermissionsBitField.Flags.ManageChannels)
  ) {
    await interaction.reply({
      content: "You need the 'Manage Channels' permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  switch (subcommand) {
    case "enable":
      await handleEnableAutoRecord(interaction);
      break;
    case "disable":
      await handleDisableAutoRecord(interaction);
      break;
    case "enable-all":
      await handleEnableAllAutoRecord(interaction);
      break;
    case "disable-all":
      await handleDisableAutoRecordAll(interaction);
      break;
    case "list":
      await handleListAutoRecord(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

async function handleEnableAutoRecord(
  interaction: ChatInputCommandInteraction,
) {
  const voiceChannelOption = interaction.options.getChannel("voice-channel");
  const textChannelOption = interaction.options.getChannel("text-channel");

  if (!voiceChannelOption || !textChannelOption) {
    await interaction.reply({
      content: "Both voice channel and text channel are required.",
      ephemeral: true,
    });
    return;
  }

  const voiceChannel = voiceChannelOption as VoiceBasedChannel;
  const textChannel = textChannelOption as TextChannel;
  const tagsRaw = interaction.options.getString("tags") || undefined;

  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "Please select a valid voice channel.",
      ephemeral: true,
    });
    return;
  }

  if (!textChannel || textChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "Please select a valid text channel.",
      ephemeral: true,
    });
    return;
  }

  // Check if bot has permissions in both channels
  const botMember = interaction.guild!.members.cache.get(
    interaction.client.user!.id,
  );

  if (!botMember) {
    await interaction.reply({
      content: "Bot not found in guild.",
      ephemeral: true,
    });
    return;
  }

  const voicePermissions = voiceChannel.permissionsFor(botMember);
  const textPermissions = textChannel.permissionsFor(botMember);

  if (
    !voicePermissions ||
    !voicePermissions.has(PermissionsBitField.Flags.ViewChannel) ||
    !voicePermissions.has(PermissionsBitField.Flags.Connect)
  ) {
    await interaction.reply({
      content: `I don't have permission to join ${voiceChannel.name}.`,
      ephemeral: true,
    });
    return;
  }

  if (
    !textPermissions ||
    !textPermissions.has(PermissionsBitField.Flags.ViewChannel) ||
    !textPermissions.has(PermissionsBitField.Flags.SendMessages)
  ) {
    await interaction.reply({
      content: `I don't have permission to send messages in ${textChannel.name}.`,
      ephemeral: true,
    });
    return;
  }

  const setting: AutoRecordSettings = {
    guildId: interaction.guild!.id,
    channelId: voiceChannel.id,
    textChannelId: textChannel.id,
    enabled: true,
    recordAll: false,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    tags: parseTags(tagsRaw),
  };

  try {
    await writeAutoRecordSetting(setting);

    const embed = new EmbedBuilder()
      .setTitle("Auto-Record Enabled")
      .setDescription(
        `Auto-recording has been enabled for **${voiceChannel.name}**`,
      )
      .addFields(
        { name: "Voice Channel", value: voiceChannel.name, inline: true },
        { name: "Text Channel", value: textChannel.name, inline: true },
      )
      .setColor(0x00ae86)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error enabling auto-record:", error);
    await interaction.reply({
      content: "Failed to enable auto-recording. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleDisableAutoRecord(
  interaction: ChatInputCommandInteraction,
) {
  const voiceChannelOption = interaction.options.getChannel("voice-channel");

  if (!voiceChannelOption) {
    await interaction.reply({
      content: "Voice channel is required.",
      ephemeral: true,
    });
    return;
  }

  const voiceChannel = voiceChannelOption as VoiceBasedChannel;

  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "Please select a valid voice channel.",
      ephemeral: true,
    });
    return;
  }

  try {
    const existing = await getAutoRecordSetting(
      interaction.guild!.id,
      voiceChannel.id,
    );

    if (!existing) {
      await interaction.reply({
        content: `Auto-recording is not enabled for **${voiceChannel.name}**.`,
        ephemeral: true,
      });
      return;
    }

    await deleteAutoRecordSetting(interaction.guild!.id, voiceChannel.id);

    const embed = new EmbedBuilder()
      .setTitle("Auto-Record Disabled")
      .setDescription(
        `Auto-recording has been disabled for **${voiceChannel.name}**`,
      )
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error disabling auto-record:", error);
    await interaction.reply({
      content: "Failed to disable auto-recording. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleDisableAutoRecordAll(
  interaction: ChatInputCommandInteraction,
) {
  try {
    const existing = await getAutoRecordSetting(interaction.guild!.id, "ALL");

    if (!existing) {
      await interaction.reply({
        content: "Auto-recording for all channels is not enabled.",
        ephemeral: true,
      });
      return;
    }

    await deleteAutoRecordSetting(interaction.guild!.id, "ALL");

    const embed = new EmbedBuilder()
      .setTitle("Auto-Record Disabled for All Channels")
      .setDescription("Auto-recording has been disabled for all voice channels")
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error disabling auto-record for all:", error);
    await interaction.reply({
      content:
        "Failed to disable auto-recording for all channels. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleEnableAllAutoRecord(
  interaction: ChatInputCommandInteraction,
) {
  const textChannelOption = interaction.options.getChannel("text-channel");
  const tagsRaw = interaction.options.getString("tags") || undefined;

  if (!textChannelOption) {
    await interaction.reply({
      content: "Text channel is required.",
      ephemeral: true,
    });
    return;
  }

  const textChannel = textChannelOption as TextChannel;

  if (!textChannel || textChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "Please select a valid text channel.",
      ephemeral: true,
    });
    return;
  }

  // Check if bot has permissions in text channel
  const botMember = interaction.guild!.members.cache.get(
    interaction.client.user!.id,
  );

  if (!botMember) {
    await interaction.reply({
      content: "Bot not found in guild.",
      ephemeral: true,
    });
    return;
  }

  const textPermissions = textChannel.permissionsFor(botMember);

  if (
    !textPermissions ||
    !textPermissions.has(PermissionsBitField.Flags.ViewChannel) ||
    !textPermissions.has(PermissionsBitField.Flags.SendMessages)
  ) {
    await interaction.reply({
      content: `I don't have permission to send messages in ${textChannel.name}.`,
      ephemeral: true,
    });
    return;
  }

  const setting: AutoRecordSettings = {
    guildId: interaction.guild!.id,
    channelId: "ALL",
    textChannelId: textChannel.id,
    enabled: true,
    recordAll: true,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    tags: parseTags(tagsRaw),
  };

  try {
    // Check if there's already a record-all setting
    const existing = await getAutoRecordSetting(interaction.guild!.id, "ALL");
    if (existing) {
      await interaction.reply({
        content:
          "Auto-recording for all channels is already enabled. Use `/autorecord disable-all` to disable it first.",
        ephemeral: true,
      });
      return;
    }

    await writeAutoRecordSetting(setting);

    const embed = new EmbedBuilder()
      .setTitle("Auto-Record Enabled for All Channels")
      .setDescription(
        `Auto-recording has been enabled for **all voice channels**`,
      )
      .addFields({
        name: "Text Channel",
        value: textChannel.name,
        inline: true,
      })
      .setColor(0x00ae86)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error enabling auto-record for all:", error);
    await interaction.reply({
      content:
        "Failed to enable auto-recording for all channels. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleListAutoRecord(interaction: ChatInputCommandInteraction) {
  try {
    const settings = await getAllAutoRecordSettings(interaction.guild!.id);

    if (settings.length === 0) {
      await interaction.reply({
        content: "No auto-record settings configured for this server.",
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Auto-Record Settings")
      .setDescription(
        `Found ${settings.length} auto-record configuration(s) for this server`,
      )
      .setColor(0x3498db)
      .setTimestamp();

    for (const setting of settings) {
      if (setting.recordAll) {
        const textChannel = interaction.guild!.channels.cache.get(
          setting.textChannelId,
        );
        embed.addFields({
          name: "📹 All Voice Channels",
          value: `Text Channel: ${textChannel ? textChannel.name : "Unknown"}\nStatus: ${setting.enabled ? "✅ Enabled" : "❌ Disabled"}`,
          inline: false,
        });
      } else {
        const voiceChannel = interaction.guild!.channels.cache.get(
          setting.channelId,
        );
        const textChannel = interaction.guild!.channels.cache.get(
          setting.textChannelId,
        );
        embed.addFields({
          name: `🎤 ${voiceChannel ? voiceChannel.name : "Unknown Channel"}`,
          value: `Text Channel: ${textChannel ? textChannel.name : "Unknown"}\nStatus: ${setting.enabled ? "✅ Enabled" : "❌ Disabled"}`,
          inline: true,
        });
      }
    }

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error listing auto-record settings:", error);
    await interaction.reply({
      content: "Failed to list auto-record settings. Please try again later.",
      ephemeral: true,
    });
  }
}
