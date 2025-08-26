import {
  ChatInputCommandInteraction,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
} from "discord.js";
import {
  writeServerContext,
  getServerContext,
  deleteServerContext,
  writeChannelContext,
  getChannelContext,
  getAllChannelContexts,
  deleteChannelContext,
} from "../db";
import { ServerContext, ChannelContext } from "../types/db";

export async function handleContextCommand(
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
    case "set-server":
      await handleSetServerContext(interaction);
      break;
    case "set-channel":
      await handleSetChannelContext(interaction);
      break;
    case "view":
      await handleViewContext(interaction);
      break;
    case "clear-server":
      await handleClearServerContext(interaction);
      break;
    case "clear-channel":
      await handleClearChannelContext(interaction);
      break;
    case "list":
      await handleListContexts(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

async function handleSetServerContext(
  interaction: ChatInputCommandInteraction,
) {
  const contextText = interaction.options.getString("context", true);

  if (contextText.length > 2000) {
    await interaction.reply({
      content: "Context must be 2000 characters or less.",
      ephemeral: true,
    });
    return;
  }

  const serverContext: ServerContext = {
    guildId: interaction.guild!.id,
    context: contextText,
    updatedAt: new Date().toISOString(),
    updatedBy: interaction.user.id,
  };

  try {
    await writeServerContext(serverContext);

    const embed = new EmbedBuilder()
      .setTitle("Server Context Updated")
      .setDescription("The server-wide context has been updated successfully.")
      .addFields(
        { name: "Context", value: contextText.substring(0, 1024) },
        {
          name: "Updated By",
          value: `<@${interaction.user.id}>`,
          inline: true,
        },
        {
          name: "Updated At",
          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
          inline: true,
        },
      )
      .setColor(0x00ae86)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error setting server context:", error);
    await interaction.reply({
      content: "Failed to set server context. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleSetChannelContext(
  interaction: ChatInputCommandInteraction,
) {
  const channel = interaction.options.getChannel("channel", true);
  const contextText = interaction.options.getString("context", true);

  if (contextText.length > 2000) {
    await interaction.reply({
      content: "Context must be 2000 characters or less.",
      ephemeral: true,
    });
    return;
  }

  if (channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "Please select a voice channel.",
      ephemeral: true,
    });
    return;
  }

  const channelContext: ChannelContext = {
    guildId: interaction.guild!.id,
    channelId: channel.id,
    context: contextText,
    updatedAt: new Date().toISOString(),
    updatedBy: interaction.user.id,
  };

  try {
    await writeChannelContext(channelContext);

    const embed = new EmbedBuilder()
      .setTitle("Channel Context Updated")
      .setDescription(
        `Context for **${channel.name}** has been updated successfully.`,
      )
      .addFields(
        { name: "Context", value: contextText.substring(0, 1024) },
        {
          name: "Updated By",
          value: `<@${interaction.user.id}>`,
          inline: true,
        },
        {
          name: "Updated At",
          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
          inline: true,
        },
      )
      .setColor(0x00ae86)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error setting channel context:", error);
    await interaction.reply({
      content: "Failed to set channel context. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleViewContext(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel("channel");

  try {
    const serverContext = await getServerContext(interaction.guild!.id);
    let channelContext: ChannelContext | undefined;

    if (channel) {
      channelContext = await getChannelContext(
        interaction.guild!.id,
        channel.id,
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("Context Information")
      .setColor(0x3498db)
      .setTimestamp();

    if (serverContext) {
      embed.addFields({
        name: "Server Context",
        value: serverContext.context.substring(0, 1024),
      });
      embed.addFields({
        name: "Server Context Metadata",
        value: `Updated by <@${serverContext.updatedBy}> on <t:${Math.floor(new Date(serverContext.updatedAt).getTime() / 1000)}:F>`,
      });
    } else {
      embed.addFields({
        name: "Server Context",
        value: "*No server context set*",
      });
    }

    if (channel) {
      if (channelContext) {
        embed.addFields({
          name: `Channel Context (${channel.name})`,
          value: channelContext.context.substring(0, 1024),
        });
        embed.addFields({
          name: "Channel Context Metadata",
          value: `Updated by <@${channelContext.updatedBy}> on <t:${Math.floor(new Date(channelContext.updatedAt).getTime() / 1000)}:F>`,
        });
      } else {
        embed.addFields({
          name: `Channel Context (${channel.name})`,
          value: "*No channel context set*",
        });
      }
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error("Error viewing context:", error);
    await interaction.reply({
      content: "Failed to retrieve context. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleClearServerContext(
  interaction: ChatInputCommandInteraction,
) {
  try {
    const existing = await getServerContext(interaction.guild!.id);
    if (!existing) {
      await interaction.reply({
        content: "No server context to clear.",
        ephemeral: true,
      });
      return;
    }

    await deleteServerContext(interaction.guild!.id);

    const embed = new EmbedBuilder()
      .setTitle("Server Context Cleared")
      .setDescription("The server-wide context has been removed.")
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error clearing server context:", error);
    await interaction.reply({
      content: "Failed to clear server context. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleClearChannelContext(
  interaction: ChatInputCommandInteraction,
) {
  const channel = interaction.options.getChannel("channel", true);

  try {
    const existing = await getChannelContext(interaction.guild!.id, channel.id);
    if (!existing) {
      await interaction.reply({
        content: `No context set for **${channel.name}**.`,
        ephemeral: true,
      });
      return;
    }

    await deleteChannelContext(interaction.guild!.id, channel.id);

    const embed = new EmbedBuilder()
      .setTitle("Channel Context Cleared")
      .setDescription(`Context for **${channel.name}** has been removed.`)
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error clearing channel context:", error);
    await interaction.reply({
      content: "Failed to clear channel context. Please try again later.",
      ephemeral: true,
    });
  }
}

async function handleListContexts(interaction: ChatInputCommandInteraction) {
  try {
    const serverContext = await getServerContext(interaction.guild!.id);
    const channelContexts = await getAllChannelContexts(interaction.guild!.id);

    const embed = new EmbedBuilder()
      .setTitle("All Contexts in Server")
      .setColor(0x3498db)
      .setTimestamp();

    // Add server context
    if (serverContext) {
      embed.addFields({
        name: "📋 Server Context",
        value:
          serverContext.context.substring(0, 200) +
          (serverContext.context.length > 200 ? "..." : ""),
      });
    }

    // Add channel contexts
    if (channelContexts.length > 0) {
      const channelList = await Promise.all(
        channelContexts.map(async (ctx) => {
          const channel = await interaction.guild!.channels.fetch(
            ctx.channelId,
          );
          const preview =
            ctx.context.substring(0, 100) +
            (ctx.context.length > 100 ? "..." : "");
          return `**${channel?.name || "Unknown Channel"}**: ${preview}`;
        }),
      );

      embed.addFields({
        name: `📢 Channel Contexts (${channelContexts.length})`,
        value: channelList.join("\n").substring(0, 1024),
      });
    } else {
      embed.addFields({
        name: "📢 Channel Contexts",
        value: "*No channel contexts set*",
      });
    }

    if (!serverContext && channelContexts.length === 0) {
      embed.setDescription("No contexts have been set for this server.");
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error("Error listing contexts:", error);
    await interaction.reply({
      content: "Failed to list contexts. Please try again later.",
      ephemeral: true,
    });
  }
}
