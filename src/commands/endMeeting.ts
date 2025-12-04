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
