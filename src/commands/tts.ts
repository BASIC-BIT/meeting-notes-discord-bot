import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { getMeeting } from "../meetings";
import { setUserSpeechSettings } from "../services/userSpeechSettingsService";
import { nowIso } from "../utils/time";
import { TTS_VOICES, normalizeTtsVoice } from "../utils/ttsVoices";
import type { UserSpeechSettings } from "../types/db";
import type { MeetingData } from "../types/meeting-data";

const MAX_VOICE_LENGTH = 32;

type TtsSubcommandHandler = (
  interaction: ChatInputCommandInteraction,
  guildId: string,
) => Promise<void>;

type UserSettingsUpdate = {
  chatTtsDisabled?: boolean;
  chatTtsVoice?: string | null;
};

const applyMeetingUserSettingsCache = (options: {
  meeting: MeetingData | undefined;
  guildId: string;
  userId: string;
  updatedBy: string;
  update: UserSettingsUpdate;
}) => {
  const { meeting, guildId, userId, updatedBy, update } = options;
  if (!meeting || meeting.finished) return;
  if (!meeting.chatTtsUserSettings) {
    meeting.chatTtsUserSettings = new Map();
  }
  const existing = meeting.chatTtsUserSettings.get(userId) ?? null;
  const nextDisabled =
    update.chatTtsDisabled !== undefined
      ? update.chatTtsDisabled
      : existing?.chatTtsDisabled;
  const nextVoice =
    update.chatTtsVoice === null
      ? undefined
      : (update.chatTtsVoice ?? existing?.chatTtsVoice);

  if (!nextDisabled && !nextVoice) {
    meeting.chatTtsUserSettings.delete(userId);
    return;
  }

  const nextSettings: UserSpeechSettings = {
    guildId,
    userId,
    updatedAt: nowIso(),
    updatedBy,
    ...(nextDisabled ? { chatTtsDisabled: true } : {}),
    ...(nextVoice ? { chatTtsVoice: nextVoice } : {}),
  };
  meeting.chatTtsUserSettings.set(userId, nextSettings);
};

const handleDisable: TtsSubcommandHandler = async (interaction, guildId) => {
  await setUserSpeechSettings(
    guildId,
    interaction.user.id,
    interaction.user.id,
    {
      chatTtsDisabled: true,
    },
  );
  applyMeetingUserSettingsCache({
    meeting: getMeeting(guildId),
    guildId,
    userId: interaction.user.id,
    updatedBy: interaction.user.id,
    update: { chatTtsDisabled: true },
  });
  await interaction.reply({
    content: "Your chat messages will no longer be spoken aloud here.",
    ephemeral: true,
  });
};

const handleEnable: TtsSubcommandHandler = async (interaction, guildId) => {
  await setUserSpeechSettings(
    guildId,
    interaction.user.id,
    interaction.user.id,
    {
      chatTtsDisabled: false,
    },
  );
  applyMeetingUserSettingsCache({
    meeting: getMeeting(guildId),
    guildId,
    userId: interaction.user.id,
    updatedBy: interaction.user.id,
    update: { chatTtsDisabled: false },
  });
  await interaction.reply({
    content: "Your chat messages can be spoken aloud again.",
    ephemeral: true,
  });
};

const handleVoice: TtsSubcommandHandler = async (interaction, guildId) => {
  const rawVoice = interaction.options.getString("voice", true).trim();
  if (!rawVoice) {
    await interaction.reply({
      content: "Please provide a voice name.",
      ephemeral: true,
    });
    return;
  }
  if (rawVoice.length > MAX_VOICE_LENGTH) {
    await interaction.reply({
      content: "Voice name is too long.",
      ephemeral: true,
    });
    return;
  }

  const normalized = rawVoice.toLowerCase();
  if (normalized !== "default" && !normalizeTtsVoice(normalized)) {
    await interaction.reply({
      content:
        `Unsupported voice. Choose one of: ${TTS_VOICES.join(", ")}, ` +
        'or use "default" to reset.',
      ephemeral: true,
    });
    return;
  }

  const voiceValue =
    normalized === "default" ? null : (normalizeTtsVoice(normalized) ?? null);
  await setUserSpeechSettings(
    guildId,
    interaction.user.id,
    interaction.user.id,
    {
      chatTtsVoice: voiceValue,
    },
  );
  applyMeetingUserSettingsCache({
    meeting: getMeeting(guildId),
    guildId,
    userId: interaction.user.id,
    updatedBy: interaction.user.id,
    update: { chatTtsVoice: voiceValue },
  });
  await interaction.reply({
    content: voiceValue
      ? `Saved your chat-to-speech voice as "${voiceValue}".`
      : "Reset your chat-to-speech voice to the server default.",
    ephemeral: true,
  });
};

const handleStop: TtsSubcommandHandler = async (interaction, guildId) => {
  const meeting = getMeeting(guildId);
  if (!meeting || meeting.finished) {
    await interaction.reply({
      content: "No active meeting to stop.",
      ephemeral: true,
    });
    return;
  }
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const isCreator = meeting.creator.id === interaction.user.id;
  const canManage =
    member?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false;
  if (!isCreator && !canManage) {
    await interaction.reply({
      content:
        "You need to be the meeting creator or have Manage Channels to stop audio.",
      ephemeral: true,
    });
    return;
  }
  meeting.ttsQueue?.stopAndClear();
  await interaction.reply({
    content: "Stopped current playback and cleared the queue.",
    ephemeral: true,
  });
};

const subcommandHandlers: Record<string, TtsSubcommandHandler> = {
  disable: handleDisable,
  enable: handleEnable,
  voice: handleVoice,
  stop: handleStop,
};

export async function handleTtsCommand(
  interaction: ChatInputCommandInteraction,
) {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const handler = subcommandHandlers[interaction.options.getSubcommand()];
  if (!handler) {
    await interaction.reply({
      content: "Unknown /tts command.",
      ephemeral: true,
    });
    return;
  }

  await handler(interaction, interaction.guildId);
}
