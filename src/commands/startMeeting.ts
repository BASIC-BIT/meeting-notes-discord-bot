import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  CommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionsBitField,
  TextChannel,
  VoiceBasedChannel,
} from "discord.js";
import {
  deleteMeeting,
  getMeeting,
  hasMeeting,
  initializeMeeting,
} from "../meetings";
import { getAutoRecordSetting } from "../db";
import { GuildChannel } from "discord.js/typings";
import { checkBotPermissions } from "../utils/permissions";
import { handleEndMeetingOther } from "./endMeeting";
import { parseTags } from "../utils/tags";

export async function handleRequestStartMeeting(
  interaction: CommandInteraction,
) {
  const guildId = interaction.guildId!;
  const meetingContext = interaction.isChatInputCommand()
    ? interaction.options.getString("context") || undefined
    : undefined;
  const tags = interaction.isChatInputCommand()
    ? interaction.options.getString("tags")
    : undefined;

  const channel = interaction.channel;

  if (!channel || !interaction.guild) {
    await interaction.reply("Unable to find the channel or guild.");
    return;
  }

  if (channel.isDMBased()) {
    await interaction.reply("Bot cannot be used within DMs.");
    return;
  }

  const guildChannel = channel as GuildChannel;
  const textChannel = channel as TextChannel;

  // Check if the bot has permission to send messages in the channel
  const botMember = interaction.guild.members.cache.get(
    interaction.client.user!.id,
  );

  if (!botMember) {
    await interaction.reply("Bot not found in guild.");
    return;
  }

  const chatChannelPermissions = guildChannel.permissionsFor(botMember);

  if (
    !chatChannelPermissions ||
    !chatChannelPermissions.has(PermissionsBitField.Flags.SendMessages) ||
    !chatChannelPermissions.has(PermissionsBitField.Flags.ViewChannel)
  ) {
    await interaction.reply(
      "I do not have permission to send messages in this channel.",
    );
    return;
  }

  if (hasMeeting(guildId)) {
    const meeting = getMeeting(guildId)!;
    if (meeting.finished) {
      // Cleanup the old meeting in preparation for a new one
      // TODO: Eventually, store meetings in a database and get rid of this, no need to remove data unnecessarily
      deleteMeeting(guildId);
    } else {
      await interaction.reply("A meeting is already active in this server.");
      return;
    }
  }

  const untypedMember = interaction.member;
  if (!untypedMember || !interaction.guild) return;
  const member = untypedMember as GuildMember;

  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await interaction.reply("You need to join a voice channel first!");
    return;
  }

  // Check bot permissions
  const permissionCheck = checkBotPermissions(
    voiceChannel,
    textChannel,
    botMember,
  );

  if (!permissionCheck.success) {
    await interaction.reply(permissionCheck.errorMessage!);
    return;
  }

  // Initialize the meeting using the core function
  const meeting = await initializeMeeting({
    voiceChannel,
    textChannel,
    guild: interaction.guild,
    creator: interaction.user,
    transcribeMeeting: true,
    generateNotes: true,
    meetingContext,
    initialInteraction: undefined,
    isAutoRecording: false,
    tags: tags ? parseTags(tags) : undefined,
    onTimeout: (meeting) => handleEndMeetingOther(interaction.client, meeting),
  });

  const embed = new EmbedBuilder()
    .setTitle("Meeting Started")
    .setDescription(`The meeting has started in **${voiceChannel.name}**.`)
    .addFields({
      name: "Start Time",
      value: `<t:${Math.floor(meeting.startTime.getTime() / 1000)}:F>`,
    })
    .setColor(0x00ae86)
    .setTimestamp();

  if (meetingContext) {
    embed.addFields({
      name: "Meeting Context",
      value: meetingContext,
    });
  }

  const endButton = new ButtonBuilder()
    .setCustomId("end_meeting")
    .setLabel("End Meeting")
    .setStyle(ButtonStyle.Danger);

  const editTagsButton = new ButtonBuilder()
    .setCustomId("edit_tags")
    .setLabel("Edit Tags")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    endButton,
    editTagsButton,
  );

  const reply = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });
  meeting.startMessageId = reply.id;
}

export async function handleAutoStartMeeting(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  textChannel: TextChannel,
) {
  const autoSetting =
    (await getAutoRecordSetting(voiceChannel.guild.id, voiceChannel.id)) ||
    (await getAutoRecordSetting(voiceChannel.guild.id, "ALL"));

  const guildId = voiceChannel.guild.id;

  // Check if a meeting is already active
  if (hasMeeting(guildId)) {
    const meeting = getMeeting(guildId)!;
    if (!meeting.finished) {
      // Meeting already active, send notification about conflict
      await textChannel.send(
        `Cannot start auto-recording in **${voiceChannel.name}** - the bot is already recording in another channel.`,
      );
      return false;
    }
    // Clean up finished meeting
    deleteMeeting(guildId);
  }

  // Check if bot has necessary permissions
  const botMember = voiceChannel.guild.members.cache.get(client.user!.id);
  if (!botMember) {
    await textChannel.send(
      `Cannot start auto-recording - bot not found in server.`,
    );
    return false;
  }

  // Check bot permissions
  const permissionCheck = checkBotPermissions(
    voiceChannel,
    textChannel,
    botMember,
  );

  if (!permissionCheck.success) {
    // Try to send error message if we have text channel permissions
    try {
      await textChannel.send(
        `Cannot start auto-recording - ${permissionCheck.errorMessage}`,
      );
    } catch {
      console.error(
        `No permissions to send messages in text channel ${textChannel.id}`,
      );
    }
    return false;
  }

  // Initialize the meeting using the core function
  const meeting = await initializeMeeting({
    voiceChannel,
    textChannel,
    guild: voiceChannel.guild,
    creator: client.user!,
    transcribeMeeting: true, // Always transcribe for auto-recordings
    generateNotes: true, // Always generate notes for auto-recordings
    initialInteraction: undefined, // No interaction for auto-recordings
    isAutoRecording: true,
    tags: autoSetting?.tags,
    onTimeout: (meeting) => handleEndMeetingOther(client, meeting),
  });

  // Send notification that auto-recording has started
  const embed = new EmbedBuilder()
    .setTitle("🔴 Auto-Recording Started")
    .setDescription(`Auto-recording has started in **${voiceChannel.name}**`)
    .addFields({
      name: "Start Time",
      value: `<t:${Math.floor(meeting.startTime.getTime() / 1000)}:F>`,
    })
    .setColor(0xff0000)
    .setTimestamp();

  const endButton = new ButtonBuilder()
    .setCustomId("end_meeting")
    .setLabel("End Recording")
    .setStyle(ButtonStyle.Danger);

  const editTagsButton = new ButtonBuilder()
    .setCustomId("edit_tags")
    .setLabel("Edit Tags")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    endButton,
    editTagsButton,
  );

  const message = await textChannel.send({
    embeds: [embed],
    components: [row],
  });
  meeting.startMessageId = message.id;

  return true;
}
