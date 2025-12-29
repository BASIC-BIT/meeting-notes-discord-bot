import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  ModalSubmitInteraction,
  Partials,
  RepliableInteraction,
  REST,
  SlashCommandBuilder,
  TextChannel,
  VoiceState,
  ChannelSelectMenuInteraction,
} from "discord.js";
import { Routes } from "discord-api-types/v10";
import { getAllMeetings, getMeeting } from "./meetings";
import {
  handleRequestStartMeeting,
  handleAutoStartMeeting,
} from "./commands/startMeeting";
import { handleAutoRecordCommand } from "./commands/autorecord";
import { handleContextCommand } from "./commands/context";
import { getAutoRecordSettingByChannel } from "./services/autorecordService";
import { fetchServerContext } from "./services/appContextService";
import { resolveMeetingVoiceSettings } from "./services/meetingVoiceSettingsService";
import { getGuildLimits } from "./services/subscriptionService";
import { formatParticipantLabel, fromMember } from "./utils/participants";
import {
  handleEndMeetingButton,
  handleEndMeetingOther,
} from "./commands/endMeeting";
import { subscribeToUserVoice, unsubscribeToVoiceUponLeaving } from "./audio";
import { generateAndSendImage } from "./commands/generateImage";
import {
  handleNotesCorrectionButton,
  handleNotesCorrectionModal,
  isNotesCorrectionButton,
  isNotesCorrectionAccept,
  isNotesCorrectionReject,
  handleNotesCorrectionAccept,
  handleNotesCorrectionReject,
  isNotesCorrectionModal,
} from "./commands/notesCorrections";
import { config } from "./services/configService";
import {
  handleEditTagsButton,
  handleEditTagsModal,
  isEditTagsButton,
  isEditTagsModal,
  handleEditTagsHistoryButton,
  handleEditTagsHistoryModal,
  isEditTagsHistoryButton,
  isEditTagsHistoryModal,
} from "./commands/tags";
import { handleAskCommand } from "./commands/ask";
import { billingCommand, handleBillingCommand } from "./commands/billing";
import { handleSayCommand } from "./commands/say";
import { handleTtsCommand } from "./commands/tts";
import { TTS_VOICE_OPTIONS } from "./utils/ttsVoices";
import {
  handleOnboardButtonInteraction,
  handleOnboardChannelSelect,
  handleOnboardCommand,
  handleOnboardModalSubmit,
  isOnboardButton,
  isOnboardChannelSelect,
  isOnboardModal,
  onboardCommand,
} from "./commands/onboard";
import { fetchGuildInstaller } from "./services/guildInstallerService";

const TOKEN = config.discord.botToken;
const CLIENT_ID = config.discord.clientId;
const TTS_VOICE_CHOICES = [
  { name: "Default (server)", value: "default" },
  ...TTS_VOICE_OPTIONS.map(({ label, value }) => ({
    name: label,
    value,
  })),
];

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

const replyOnboardingDisabled = async (interaction: RepliableInteraction) => {
  await interaction.reply({
    content: "Onboarding is currently disabled for this bot.",
    ephemeral: true,
  });
};

const commandHandlers: Record<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
> = {
  autorecord: handleAutoRecordCommand,
  ask: handleAskCommand,
  context: handleContextCommand,
  billing: handleBillingCommand,
  say: handleSayCommand,
  tts: handleTtsCommand,
};

const handleCommandInteraction = async (
  interaction: ChatInputCommandInteraction,
) => {
  const { commandName } = interaction;
  if (commandName === "startmeeting") {
    await handleRequestStartMeeting(interaction);
    return;
  }
  if (commandName === "onboard") {
    if (!config.server.onboardingEnabled) {
      await replyOnboardingDisabled(interaction);
      return;
    }
    await handleOnboardCommand(interaction);
    return;
  }
  const handler = commandHandlers[commandName];
  if (handler) {
    await handler(interaction);
  }
};

const modalHandlers: Array<{
  matches: (customId: string) => boolean;
  handle: (interaction: ModalSubmitInteraction) => Promise<void>;
  onboarding?: boolean;
}> = [
  {
    matches: isNotesCorrectionModal,
    handle: handleNotesCorrectionModal,
  },
  {
    matches: isEditTagsModal,
    handle: handleEditTagsModal,
  },
  {
    matches: isEditTagsHistoryModal,
    handle: handleEditTagsHistoryModal,
  },
  {
    matches: isOnboardModal,
    handle: handleOnboardModalSubmit,
    onboarding: true,
  },
];

const handleModalInteraction = async (interaction: ModalSubmitInteraction) => {
  for (const entry of modalHandlers) {
    if (!entry.matches(interaction.customId)) continue;
    if (entry.onboarding && !config.server.onboardingEnabled) {
      await replyOnboardingDisabled(interaction);
      return;
    }
    await entry.handle(interaction);
    return;
  }
};

const buttonHandlers: Array<{
  matches: (customId: string) => boolean;
  handle: (interaction: ButtonInteraction) => Promise<void>;
  onboarding?: boolean;
}> = [
  {
    matches: isNotesCorrectionAccept,
    handle: handleNotesCorrectionAccept,
  },
  {
    matches: isNotesCorrectionReject,
    handle: handleNotesCorrectionReject,
  },
  {
    matches: isNotesCorrectionButton,
    handle: handleNotesCorrectionButton,
  },
  {
    matches: isEditTagsButton,
    handle: handleEditTagsButton,
  },
  {
    matches: isEditTagsHistoryButton,
    handle: handleEditTagsHistoryButton,
  },
  {
    matches: isOnboardButton,
    handle: handleOnboardButtonInteraction,
    onboarding: true,
  },
];

const handleButtonInteraction = async (interaction: ButtonInteraction) => {
  for (const entry of buttonHandlers) {
    if (!entry.matches(interaction.customId)) continue;
    if (entry.onboarding && !config.server.onboardingEnabled) {
      await replyOnboardingDisabled(interaction);
      return;
    }
    await entry.handle(interaction);
    return;
  }

  if (interaction.customId === "end_meeting") {
    await handleEndMeetingButton(client, interaction);
    return;
  }
  if (interaction.customId === "generate_image") {
    await generateAndSendImage(interaction);
  }
};

const handleChannelSelectInteraction = async (
  interaction: ChannelSelectMenuInteraction,
) => {
  if (!isOnboardChannelSelect(interaction.customId)) return;
  if (!config.server.onboardingEnabled) {
    await replyOnboardingDisabled(interaction);
    return;
  }
  await handleOnboardChannelSelect(interaction);
};

const handleInteractionCreate = async (interaction: RepliableInteraction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommandInteraction(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    await handleModalInteraction(interaction);
    return;
  }
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }
  if (interaction.isChannelSelectMenu()) {
    await handleChannelSelectInteraction(interaction);
  }
};

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

  client.on("guildCreate", async (guild) => {
    if (!config.server.onboardingEnabled) {
      return;
    }
    try {
      const installer = await fetchGuildInstaller(guild.id);
      const dmTarget =
        installer?.installerId &&
        (await client.users.fetch(installer.installerId).catch(() => null));
      const recipient = dmTarget ?? (await guild.fetchOwner());
      if (recipient) {
        const targetUser = "user" in recipient ? recipient.user : recipient;
        await targetUser.send(
          "Thanks for adding Meeting Notes Bot! Run `/onboard` in your server (Manage Guild required) for a 1-minute setup.",
        );
      }
    } catch (err) {
      console.warn("Could not DM installer/owner on join", err);
    }
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
      if (interaction.isRepliable()) {
        await handleInteractionCreate(interaction);
      }
    } catch (e) {
      console.error("Unknown error processing command: ", e);
      try {
        if (interaction.isRepliable()) {
          await interaction.reply("Unknown Error handling request.");
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
    const participant = fromMember(newState.member);
    const userLabel = formatParticipantLabel(participant, {
      includeUsername: false,
      fallbackName: newState.member.user.username,
    });
    console.log(`${userLabel} joined the voice channel.`);
    meeting.attendance.add(userLabel);
    meeting.participants.set(participant.id, participant);
    meeting.chatLog.push({
      type: "join",
      user: participant,
      channelId: newState.channelId!,
      timestamp: new Date().toISOString(),
    });

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
      let autoRecordSetting = await getAutoRecordSettingByChannel(
        newState.guild.id,
        newState.channelId!,
      );

      // If no specific setting, check for record-all setting
      if (!autoRecordSetting) {
        autoRecordSetting = await getAutoRecordSettingByChannel(
          newState.guild.id,
          "ALL",
        );
      }

      // If auto-record is enabled, start recording
      if (autoRecordSetting && autoRecordSetting.enabled) {
        const serverContext = await fetchServerContext(newState.guild.id);
        const resolvedTextChannelId =
          autoRecordSetting.textChannelId ??
          serverContext?.defaultNotesChannelId;
        if (!resolvedTextChannelId) {
          console.error(
            `No default notes channel configured for auto-record in guild ${newState.guild.id}`,
          );
          return;
        }
        const textChannel = newState.guild.channels.cache.get(
          resolvedTextChannelId,
        ) as TextChannel;

        if (textChannel && newState.channel) {
          console.log(
            `Auto-starting recording in ${newState.channel.name} due to auto-record settings`,
          );
          const { limits } = await getGuildLimits(newState.guild.id);
          const {
            liveVoiceEnabled,
            liveVoiceCommandsEnabled,
            liveVoiceTtsVoice,
            chatTtsEnabled,
            chatTtsVoice,
          } = await resolveMeetingVoiceSettings(
            newState.guild.id,
            newState.channelId!,
            limits,
          );
          const tags = autoRecordSetting.tags ?? serverContext?.defaultTags;
          await handleAutoStartMeeting(client, newState.channel, textChannel, {
            tags,
            liveVoiceEnabled,
            liveVoiceCommandsEnabled,
            liveVoiceTtsVoice,
            chatTtsEnabled,
            chatTtsVoice,
          });
        } else {
          console.error(
            `Could not find text channel ${resolvedTextChannelId} for auto-recording`,
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
    const participant = fromMember(oldState.member);
    const userLabel = formatParticipantLabel(participant, {
      includeUsername: false,
      fallbackName: oldState.member.user.username,
    });
    console.log(`${userLabel} left the voice channel.`);
    meeting.participants.set(participant.id, participant);
    meeting.chatLog.push({
      type: "leave",
      user: participant,
      channelId: oldState.channelId!,
      timestamp: new Date().toISOString(),
    });

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
      .setDescription("Record a meeting with voice and chat logs.")
      .addStringOption((option) =>
        option
          .setName("context")
          .setDescription(
            'Optional context about this meeting (e.g., "Sprint planning for Q1 features")',
          )
          .setRequired(false)
          .setMaxLength(500),
      )
      .addStringOption((option) =>
        option
          .setName("tags")
          .setDescription("Optional comma-separated tags for this meeting")
          .setRequired(false)
          .setMaxLength(500),
      ),
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
              .addChannelTypes(2)
              .setRequired(true),
          )
          .addChannelOption((option) =>
            option
              .setName("text-channel")
              .setDescription("The text channel to send meeting notifications")
              .addChannelTypes(0)
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("tags")
              .setDescription("Optional comma-separated tags to apply")
              .setRequired(false)
              .setMaxLength(500),
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
              .addChannelTypes(2)
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
              .addChannelTypes(0)
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("tags")
              .setDescription("Optional comma-separated tags to apply")
              .setRequired(false)
              .setMaxLength(500),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("disable-all")
          .setDescription("Disable auto-recording for all voice channels"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("list")
          .setDescription("List all auto-record settings for this server"),
      ),
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask about past meetings")
      .addStringOption((option) =>
        option
          .setName("question")
          .setDescription("Your question")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("tags")
          .setDescription("Optional comma-separated tags to filter meetings")
          .setRequired(false)
          .setMaxLength(500),
      )
      .addStringOption((option) =>
        option
          .setName("scope")
          .setDescription("Search scope")
          .addChoices(
            { name: "Guild (default)", value: "guild" },
            { name: "Channel only", value: "channel" },
          )
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName("tts")
      .setDescription("Control chat-to-speech preferences")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("disable")
          .setDescription("Do not speak your chat messages in meetings"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("enable")
          .setDescription("Allow your chat messages to be spoken in meetings"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("voice")
          .setDescription("Set your chat-to-speech voice for this server")
          .addStringOption((option) =>
            option
              .setName("voice")
              .setDescription('Voice name (or "default" to reset)')
              .setRequired(true)
              .setMaxLength(32)
              .addChoices(...TTS_VOICE_CHOICES),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("stop")
          .setDescription("Stop current bot playback and clear the queue"),
      ),
    new SlashCommandBuilder()
      .setName("say")
      .setDescription("Speak a message aloud in the meeting voice channel")
      .addStringOption((option) => {
        option
          .setName("message")
          .setDescription("Message to speak aloud")
          .setRequired(true);
        const maxLength = config.chatTts.maxChars;
        if (maxLength > 0 && maxLength <= 6000) {
          option.setMaxLength(maxLength);
        }
        return option;
      }),
    billingCommand,
    new SlashCommandBuilder()
      .setName("context")
      .setDescription(
        "Manage context settings for better meeting understanding",
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set-server")
          .setDescription("Set server-wide context for all meetings")
          .addStringOption((option) =>
            option
              .setName("context")
              .setDescription(
                "Context/instructions for the server (max 2000 chars)",
              )
              .setRequired(true)
              .setMaxLength(2000),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set-channel")
          .setDescription("Set context for a specific voice channel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("The voice channel to set context for")
              .addChannelTypes(2) // Voice channel type
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("context")
              .setDescription(
                "Context/instructions for the channel (max 2000 chars)",
              )
              .setRequired(true)
              .setMaxLength(2000),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("view")
          .setDescription("View current context settings")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Optional: View context for a specific channel")
              .addChannelTypes(2) // Voice channel type
              .setRequired(false),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("clear-server")
          .setDescription("Clear server-wide context"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("clear-channel")
          .setDescription("Clear context for a specific channel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("The voice channel to clear context for")
              .addChannelTypes(2) // Voice channel type
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("list")
          .setDescription("List all contexts in this server"),
      ),
  ];

  if (config.server.onboardingEnabled) {
    commands.push(onboardCommand);
  }

  const commandPayload = commands.map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commandPayload,
    });

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
