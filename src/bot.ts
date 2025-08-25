import { CLIENT_ID, TOKEN } from "./constants";
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  CommandInteraction,
  GatewayIntentBits,
  Partials,
  RepliableInteraction,
  REST,
  SlashCommandBuilder,
  TextChannel,
  VoiceState,
} from "discord.js";
import { Routes } from "discord-api-types/v10";
import { getAllMeetings, getMeeting } from "./meetings";
import {
  handleRequestStartMeeting,
  handleStartMeeting,
  handleAutoStartMeeting,
} from "./commands/startMeeting";
import { handleAutoRecordCommand } from "./commands/autorecord";
import { getAutoRecordSetting } from "./db";
import {
  handleEndMeetingButton,
  handleEndMeetingOther,
} from "./commands/endMeeting";
import { subscribeToUserVoice, unsubscribeToVoiceUponLeaving } from "./audio";
import { generateAndSendTodoList } from "./commands/generateTodoList";
import { generateAndSendSummary } from "./commands/generateSummary";
import { generateAndSendImage } from "./commands/generateImage";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.User],
});

export async function setupBot() {
  if (!TOKEN || !CLIENT_ID) {
    throw new Error(
      "Bot token or client ID is not defined in the environment variables",
    );
  }

  client.once("ready", () => {
    console.log(`Logged in as ${client.user?.tag}!`);

    client.on("voiceStateUpdate", handleVoiceStateUpdate);
  });

  client.on("interactionCreate", async (interaction) => {
    if (isShuttingDown) {
      // Assume another instance has already been spun up to handle traffic, and don't handle it
      console.log(
        "Interaction received but bot is shutting down. Not handling",
      );
      return;
    }
    try {
      if (interaction.isCommand()) {
        const commandInteraction = interaction as CommandInteraction;

        const { commandName } = interaction;

        if (commandName === "startmeeting") {
          await handleRequestStartMeeting(commandInteraction);
        }
        if (commandName === "autorecord") {
          await handleAutoRecordCommand(
            commandInteraction as ChatInputCommandInteraction,
          );
        }
      }
      if (interaction.isButton()) {
        const buttonInteraction = interaction as ButtonInteraction;

        if (buttonInteraction.customId === "end_meeting") {
          await handleEndMeetingButton(client, buttonInteraction);
        }
        if (buttonInteraction.customId === "with_transcription_and_notes") {
          await handleStartMeeting(buttonInteraction, true, true);
        }
        if (buttonInteraction.customId === "with_transcription") {
          await handleStartMeeting(buttonInteraction, true, false);
        }
        if (buttonInteraction.customId === "without_transcription") {
          await handleStartMeeting(buttonInteraction, false, false);
        }
        if (buttonInteraction.customId === "generate_summary") {
          await generateAndSendSummary(interaction);
        }
        if (buttonInteraction.customId === "generate_todo") {
          await generateAndSendTodoList(interaction);
        }
        if (buttonInteraction.customId === "generate_image") {
          await generateAndSendImage(interaction);
        }
        if (buttonInteraction.customId === "generate_notes") {
          // await generateAndSendNotes(interaction);
        }
      }
    } catch (e) {
      console.error("Unknown error processing command: ", e);
      try {
        if (interaction.isRepliable()) {
          const repliableInteraction = interaction as RepliableInteraction;
          await repliableInteraction.reply("Unknown Error handling request.");
        }
      } catch (e2) {
        console.error("Error replying to interaction about initial error", e2);
      }
    }
  });

  setupApplicationCommands();

  client.login(TOKEN);
}

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
) {
  // Check if the user switched channels
  if (
    oldState.channel &&
    newState.channel &&
    oldState.channelId !== newState.channelId
  ) {
    // Handle as leave from old channel
    await handleUserLeave(oldState);
    // Handle as join to new channel
    await handleUserJoin(newState);
  }
  // Check if the user joined a voice channel
  else if (!oldState.channel && newState.channel && newState.member) {
    await handleUserJoin(newState);
  }
  // Check if the user left a voice channel
  else if (oldState.channel && !newState.channel && oldState.member) {
    await handleUserLeave(oldState);
  }
}

async function handleUserJoin(newState: VoiceState) {
  const meeting = getMeeting(newState.guild.id);

  // Handle existing meeting attendance
  if (
    meeting &&
    newState.member &&
    newState.member.user.id !== client.user!.id &&
    meeting.voiceChannel.id === newState.channelId
  ) {
    const userTag = newState.member!.user.tag;
    console.log(`${userTag} joined the voice channel.`);
    meeting.attendance.add(userTag);
    // Optionally, log the time they joined
    meeting.chatLog.push(
      `[${userTag}] joined the channel at ${new Date().toLocaleTimeString()}`,
    );

    await subscribeToUserVoice(meeting, newState.member!.user.id);
    return; // Exit early if we're already recording
  }

  // Check if auto-record is enabled for this channel
  if (
    !meeting &&
    newState.channel &&
    newState.member &&
    newState.member.user.id !== client.user!.id // Don't trigger for bot joining
  ) {
    try {
      // Check for specific channel setting
      let autoRecordSetting = await getAutoRecordSetting(
        newState.guild.id,
        newState.channelId!,
      );

      // If no specific setting, check for record-all setting
      if (!autoRecordSetting) {
        autoRecordSetting = await getAutoRecordSetting(
          newState.guild.id,
          "ALL",
        );
      }

      // If auto-record is enabled, start recording
      if (autoRecordSetting && autoRecordSetting.enabled) {
        const textChannel = newState.guild.channels.cache.get(
          autoRecordSetting.textChannelId,
        ) as TextChannel;

        if (textChannel && newState.channel) {
          console.log(
            `Auto-starting recording in ${newState.channel.name} due to auto-record settings`,
          );
          await handleAutoStartMeeting(client, newState.channel, textChannel);
        } else {
          console.error(
            `Could not find text channel ${autoRecordSetting.textChannelId} for auto-recording`,
          );
        }
      }
    } catch (error) {
      console.error("Error checking auto-record settings:", error);
    }
  }
}

async function handleUserLeave(oldState: VoiceState) {
  const meeting = getMeeting(oldState.guild.id);
  if (
    meeting &&
    oldState.member &&
    oldState.member.user.id !== client.user!.id &&
    meeting.voiceChannel.id === oldState.channelId
  ) {
    const userTag = oldState.member!.user.tag;
    console.log(`${userTag} left the voice channel.`);
    // Optionally, log the time they left
    meeting.chatLog.push(
      `[${userTag}] left the channel at ${new Date().toLocaleTimeString()}`,
    );

    unsubscribeToVoiceUponLeaving(meeting, oldState.member!.user.id);

    if (meeting.voiceChannel.members.size <= 1 && !meeting.finishing) {
      await meeting.textChannel.send(
        "Meeting ending due to nobody being left in the voice channel.",
      );
      await handleEndMeetingOther(client, meeting);
    }
  }
}

async function setupApplicationCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("startmeeting")
      .setDescription("Record a meeting with voice and chat logs."),
    new SlashCommandBuilder()
      .setName("autorecord")
      .setDescription("Configure automatic recording for voice channels")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("enable")
          .setDescription("Enable auto-recording for a specific voice channel")
          .addChannelOption((option) =>
            option
              .setName("voice-channel")
              .setDescription("The voice channel to auto-record")
              .addChannelTypes(2) // Voice channel type
              .setRequired(true),
          )
          .addChannelOption((option) =>
            option
              .setName("text-channel")
              .setDescription("The text channel to send meeting notifications")
              .addChannelTypes(0) // Text channel type
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("disable")
          .setDescription("Disable auto-recording for a specific voice channel")
          .addChannelOption((option) =>
            option
              .setName("voice-channel")
              .setDescription("The voice channel to stop auto-recording")
              .addChannelTypes(2) // Voice channel type
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("enable-all")
          .setDescription("Enable auto-recording for all voice channels")
          .addChannelOption((option) =>
            option
              .setName("text-channel")
              .setDescription("The text channel to send meeting notifications")
              .addChannelTypes(0) // Text channel type
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("list")
          .setDescription("List all auto-record settings for this server"),
      ),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
}

// Signal listener to start graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, initiating graceful shutdown");

  // Stop accepting new meetings/requests
  stopHandlingNewMeetings();

  // Wait for ongoing meetings to finish
  await completeOngoingMeetings();

  // Shut down the bot gracefully
  console.log("Shutting down...");
  process.exit(0); // Exit the process when all meetings are done
});
let isShuttingDown = false;

function stopHandlingNewMeetings() {
  isShuttingDown = true;
}

async function completeOngoingMeetings() {
  const meetings = getAllMeetings();
  if (meetings.length > 0) {
    console.log("Waiting for ongoing meetings to finish...");
    await Promise.all(meetings.map((meeting) => meeting.isFinished));
  } else {
    console.log("No ongoing meetings, ready to shut down.");
  }
}
