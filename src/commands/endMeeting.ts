import {
  ButtonInteraction,
  Client,
  PermissionFlagsBits,
  PermissionResolvable,
} from "discord.js";
import { deleteMeeting, getMeeting, hasMeeting } from "../meetings";
import { writeFileSync } from "node:fs";
import {
  closeOutputFile,
  compileTranscriptions,
  splitAudioIntoChunks,
  startProcessingSnippet,
  waitForAudioOnlyFinishProcessing,
  waitForFinishProcessing,
} from "../audio";
import {
  sendMeetingEndEmbed,
  sendMeetingEndEmbedToChannel,
  sendTranscriptionFiles,
} from "../embed";
import { deleteDirectoryRecursively, deleteIfExists } from "../util";
import { MeetingData } from "../types/meeting-data";
import { generateAndSendNotes } from "./generateNotes";
import { saveMeetingHistoryToDatabase } from "./saveMeetingHistory";
import { renderChatEntryLine } from "../utils/chatLog";
import { uploadMeetingArtifacts } from "../services/uploadService";
import { buildUpgradeTextOnly } from "../utils/upgradePrompt";
import { getGuildLimits } from "../services/subscriptionService";
import {
  getNextAvailableAt,
  getRollingUsageForGuild,
  getRollingWindowMs,
} from "../services/meetingUsageService";

function doesUserHavePermissionToEndMeeting(
  meeting: MeetingData,
  userId: string,
): boolean {
  if (meeting.creator.id === userId) {
    return true; // Creator of a meeting can always end it
  }

  const member = meeting.guild.members.cache.get(userId);
  if (!member) {
    return false;
  }

  const requiresAnyPermission =
    PermissionFlagsBits.ModerateMembers +
    PermissionFlagsBits.Administrator +
    PermissionFlagsBits.ManageMessages;

  return member.permissions.any(
    requiresAnyPermission as unknown as PermissionResolvable,
  );
}

export async function handleEndMeetingButton(
  client: Client,
  interaction: ButtonInteraction,
) {
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const meeting = getMeeting(guildId);

  try {
    if (!meeting) {
      await interaction.reply("No active meeting to end in this channel.");
      return;
    }

    if (!doesUserHavePermissionToEndMeeting(meeting, interaction.user.id)) {
      await interaction.reply(
        "You do not have permission to end this meeting.",
      );
      return;
    }

    if (meeting.finishing) {
      await interaction.reply("Meeting is already finishing!");
      return;
    }

    if (meeting.finished) {
      await interaction.reply("Meeting is already finished!");
      return;
    }

    if (meeting.timeoutTimer) {
      clearTimeout(meeting.timeoutTimer);
      meeting.timeoutTimer = undefined;
    }

    meeting.finishing = true;
    meeting.endTime = new Date();
    meeting.ttsQueue?.stopAndClear();

    // Acknowledge the interaction immediately
    await interaction.deferReply();

    if (meeting.initialInteraction) {
      try {
        await meeting.initialInteraction.editReply({
          components: [],
        }); //Remove "End Meeting" button from initial reply if able
      } catch (e) {
        console.error(
          "Initial Interaction timed out, couldn't remove End Meeting button from initial reply, continuing...",
          e,
        );
      }
    }

    await clearStartMessageComponents(meeting);

    if (meeting.connection) {
      meeting.connection.disconnect();
      meeting.connection.destroy();
    }

    const chatLogFilePath = `./chatlog-${guildId}-${channelId}-${Date.now()}.txt`;
    writeFileSync(
      chatLogFilePath,
      meeting.chatLog.map((e) => renderChatEntryLine(e)).join("\n"),
    );

    // checking if the current snippet exists should only matter when there was no audio recorded at all
    meeting.audioData.currentSnippets.forEach((snippet) => {
      startProcessingSnippet(meeting, snippet.userId);
    });

    await waitForAudioOnlyFinishProcessing(meeting);

    await closeOutputFile(meeting);

    const splitAudioDir = `./split_${meeting.guildId}_${meeting.channelId}_${Date.now()}`;
    const splitFiles = await splitAudioIntoChunks(
      meeting.audioData.outputFileName!,
      splitAudioDir,
    );

    await sendMeetingEndEmbed(
      meeting,
      interaction,
      chatLogFilePath,
      splitFiles,
    );

    if (meeting.transcribeMeeting) {
      const waitingForTranscriptionsMessage = await meeting.textChannel.send(
        "Processing transcription... please wait...",
      );

      await waitForFinishProcessing(meeting);

      const transcriptions = await compileTranscriptions(client, meeting);
      meeting.finalTranscript = transcriptions;

      const transcriptionFilePath = `./transcription-${guildId}-${channelId}-${Date.now()}.txt`;
      writeFileSync(transcriptionFilePath, transcriptions);

      await sendTranscriptionFiles(meeting, transcriptionFilePath);

      deleteIfExists(transcriptionFilePath);

      await waitingForTranscriptionsMessage.delete();

      if (meeting.finalTranscript && meeting.generateNotes) {
        const waitingForMeetingNotesMessage = await meeting.textChannel.send(
          "Generating meeting notes... please wait...",
        );
        await generateAndSendNotes(meeting);
        await waitingForMeetingNotesMessage.delete();
      }

      // if(meeting.finalTranscript && meeting.finalTranscript.length > 0) {
      //     await sendPostMeetingOptions(meeting);
      // }
    }

    // Upload artifacts after transcript generation (or audio/chat only)
    await uploadMeetingArtifacts(meeting, {
      audioFilePath: meeting.audioData.outputFileName!,
      chatFilePath: chatLogFilePath,
      transcriptText: meeting.finalTranscript,
    });

    deleteIfExists(chatLogFilePath);
    deleteIfExists(meeting.audioData.outputFileName!);

    deleteDirectoryRecursively(splitAudioDir);

    // Save meeting history to database before cleanup
    await saveMeetingHistoryToDatabase(meeting);
    await maybeSendMinutesLimitNotice(meeting);

    meeting.setFinished();
    meeting.finished = true;
    deleteMeeting(meeting.guildId);
  } catch (error) {
    console.error("Error during meeting end:", error);
    if (meeting && hasMeeting(meeting.guildId)) {
      meeting.setFinished();
      meeting.finished = true;
      deleteMeeting(meeting.guildId);
    }
  }
}

async function clearStartMessageComponents(meeting: MeetingData) {
  if (!meeting.startMessageId) return;
  try {
    const message = await meeting.textChannel.messages.fetch(
      meeting.startMessageId,
    );
    await message.edit({ components: [] });
  } catch (e) {
    console.warn("Could not clear start message buttons", e);
  }
}

export async function handleEndMeetingOther(
  client: Client,
  meeting: MeetingData,
) {
  try {
    if (meeting.timeoutTimer) {
      clearTimeout(meeting.timeoutTimer);
      meeting.timeoutTimer = undefined;
    }

    meeting.finishing = true;
    meeting.endTime = new Date();
    meeting.ttsQueue?.stopAndClear();

    if (meeting.initialInteraction) {
      try {
        await meeting.initialInteraction.editReply({
          components: [],
        }); //Remove "End Meeting" button from initial reply if able
      } catch (e) {
        console.error(
          "Initial Interaction timed out, couldn't remove End Meeting button from initial reply, continuing...",
          e,
        );
      }
    }

    await clearStartMessageComponents(meeting);

    if (meeting.connection) {
      meeting.connection.disconnect();
      meeting.connection.destroy();
    }

    const chatLogFilePath = `./chatlog-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`;
    writeFileSync(
      chatLogFilePath,
      meeting.chatLog.map((e) => renderChatEntryLine(e)).join("\n"),
    );

    // checking if the current snippet exists should only matter when there was no audio recorded at all
    meeting.audioData.currentSnippets.forEach((snippet) => {
      startProcessingSnippet(meeting, snippet.userId);
    });

    await waitForAudioOnlyFinishProcessing(meeting);

    await closeOutputFile(meeting);

    const splitAudioDir = `./split_${meeting.guildId}_${meeting.channelId}_${Date.now()}`;
    const splitFiles = await splitAudioIntoChunks(
      meeting.audioData.outputFileName!,
      splitAudioDir,
    );

    await sendMeetingEndEmbedToChannel(
      meeting,
      meeting.textChannel,
      chatLogFilePath,
      splitFiles,
    );

    if (meeting.transcribeMeeting) {
      const waitingForTranscriptionsMessage = await meeting.textChannel.send(
        "Processing transcription... please wait...",
      );

      await waitForFinishProcessing(meeting);

      const transcriptions = await compileTranscriptions(client, meeting);
      meeting.finalTranscript = transcriptions;

      const transcriptionFilePath = `./transcription-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`;
      writeFileSync(transcriptionFilePath, transcriptions);

      await sendTranscriptionFiles(meeting, transcriptionFilePath);

      deleteIfExists(transcriptionFilePath);

      await waitingForTranscriptionsMessage.delete();

      if (meeting.finalTranscript && meeting.generateNotes) {
        const waitingForMeetingNotesMessage = await meeting.textChannel.send(
          "Generating meeting notes... please wait...",
        );
        await generateAndSendNotes(meeting);
        await waitingForMeetingNotesMessage.delete();
      }

      // if(meeting.finalTranscript && meeting.finalTranscript.length > 0) {
      //     await sendPostMeetingOptions(meeting);
      // }
    }

    // Upload artifacts after transcript generation (or audio/chat only)
    await uploadMeetingArtifacts(meeting, {
      audioFilePath: meeting.audioData.outputFileName!,
      chatFilePath: chatLogFilePath,
      transcriptText: meeting.finalTranscript,
    });

    deleteIfExists(chatLogFilePath);
    deleteIfExists(meeting.audioData.outputFileName!);

    deleteDirectoryRecursively(splitAudioDir);

    // Save meeting history to database before cleanup
    await saveMeetingHistoryToDatabase(meeting);
    await maybeSendMinutesLimitNotice(meeting);

    meeting.setFinished();
    meeting.finished = true;
    deleteMeeting(meeting.guildId);
  } catch (error) {
    console.error("Error during meeting end:", error);
    if (meeting && hasMeeting(meeting.guildId)) {
      meeting.setFinished();
      meeting.finished = true;
      deleteMeeting(meeting.guildId);
    }
  }
}

async function maybeSendMinutesLimitNotice(meeting: MeetingData) {
  const { limits } = await getGuildLimits(meeting.guildId);
  if (!limits.maxMeetingMinutesRolling) return;

  const usage = await getRollingUsageForGuild(meeting.guildId);
  const limitSeconds = limits.maxMeetingMinutesRolling * 60;
  const remainingSeconds = limitSeconds - usage.usedSeconds;
  const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));
  const thresholdMinutes = Math.max(
    60,
    Math.ceil(limits.maxMeetingMinutesRolling * 0.2),
  );

  const windowStartMs = Date.parse(usage.windowStartIso);
  const nextAvailableAtIso = getNextAvailableAt(
    usage.meetings,
    windowStartMs,
    getRollingWindowMs(),
    limitSeconds,
  );
  if (usage.usedSeconds >= limitSeconds) {
    const nextLabel = nextAvailableAtIso
      ? `You can record again after <t:${Math.floor(
          Date.parse(nextAvailableAtIso) / 1000,
        )}:R>.`
      : "You can record again once older meetings roll out of the window.";
    await meeting.textChannel.send(
      buildUpgradeTextOnly(
        `You've reached the weekly minutes limit for this plan. ${nextLabel}`,
      ),
    );
    return;
  }

  if (remainingMinutes <= thresholdMinutes) {
    await meeting.textChannel.send(
      buildUpgradeTextOnly(
        `Heads up: about ${remainingMinutes} minute(s) left in the weekly free-tier window.`,
      ),
    );
  }
}
