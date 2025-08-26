import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
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
import { GuildChannel } from "discord.js/typings";
import { checkBotPermissions } from "../utils/permissions";
import { handleEndMeetingOther } from "./endMeeting";

export async function handleRequestStartMeeting(
  interaction: CommandInteraction,
) {
  const guildId = interaction.guildId!;
  const meetingContext = interaction.isChatInputCommand()
    ? interaction.options.getString("context") || undefined
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

  const voiceChannelPermissions = voiceChannel.permissionsFor(botMember);

  if (
    !voiceChannelPermissions ||
    !voiceChannelPermissions.has(PermissionsBitField.Flags.ViewChannel) ||
    !voiceChannelPermissions.has(PermissionsBitField.Flags.Connect)
  ) {
    await interaction.reply(
      "I do not have permission to join your voice channel.",
    );
    return;
  }

  const withTranscriptionAndNotes = new ButtonBuilder()
    .setCustomId("with_transcription_and_notes")
    .setLabel("With Transcription And Meeting Notes")
    .setStyle(ButtonStyle.Primary);

  const withTranscription = new ButtonBuilder()
    .setCustomId("with_transcription")
    .setLabel("With Just Transcription")
    .setStyle(ButtonStyle.Primary);

  const withoutTranscription = new ButtonBuilder()
    .setCustomId("without_transcription")
    .setLabel("NO Transcription")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    withTranscriptionAndNotes,
    withTranscription,
    withoutTranscription,
  );

  // Store meeting context in button custom IDs if provided
  if (meetingContext) {
    // Encode context in button IDs to pass it through
    const encodedContext = Buffer.from(meetingContext).toString("base64");
    withTranscriptionAndNotes.setCustomId(
      `with_transcription_and_notes:${encodedContext}`,
    );
    withTranscription.setCustomId(`with_transcription:${encodedContext}`);
    withoutTranscription.setCustomId(`without_transcription:${encodedContext}`);
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Meeting Setup")
        .setColor("#3498db")
        .setDescription(
          "Would you like a transcription of your meeting? Please be aware that the transcription service I use is *not* free~ please consider [donating here](https://ko-fi.com/basicbit) if you use this feature regularly!" +
            (meetingContext
              ? `\n\n**Meeting Context:** ${meetingContext}`
              : ""),
        ),
    ],
    components: [row],
  });
}

export async function handleStartMeeting(
  interaction: ButtonInteraction,
  transcribeMeeting: boolean,
  generateNotes: boolean,
  meetingContext?: string,
) {
  const guildId = interaction.guildId!;

  const channel = interaction.channel;

  if (!channel || !interaction.guild) {
    await interaction.reply("Unable to find the channel or guild.");
    return;
  }

  if (channel.isDMBased()) {
    await interaction.reply("Bot cannot be used within DMs.");
    return;
  }

  // Check if the bot has permission to send messages in the channel
  const botMember = interaction.guild.members.cache.get(
    interaction.client.user!.id,
  );

  if (!botMember) {
    await interaction.reply("Bot not found in guild.");
    return;
  }

  const textChannel = channel as TextChannel;

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
    transcribeMeeting,
    generateNotes,
    meetingContext,
    initialInteraction: interaction,
    isAutoRecording: false,
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

  const endButton = new ButtonBuilder()
    .setCustomId("end_meeting")
    .setLabel("End Meeting")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(endButton);

  await interaction.reply({ embeds: [embed], components: [row] });
}

export async function handleAutoStartMeeting(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  textChannel: TextChannel,
) {
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

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(endButton);

  await textChannel.send({ embeds: [embed], components: [row] });

  return true;
}
