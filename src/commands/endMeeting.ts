import { ButtonInteraction, Client, EmbedBuilder } from "discord.js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { ChunkInfo } from "../types/audio";
import {
  buildMixedAudio,
  cleanupAudioSegments,
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
import { deleteIfExists } from "../util";
import { MeetingData } from "../types/meeting-data";
import { generateAndSendNotes } from "./generateNotes";
import { saveMeetingHistoryToDatabase } from "./saveMeetingHistory";
import { updateMeetingStatusService } from "../services/meetingHistoryService";
import { renderChatEntryLine } from "../utils/chatLog";
import { uploadMeetingArtifacts } from "../services/uploadService";
import { buildUpgradeTextOnly } from "../utils/upgradePrompt";
import { getGuildLimits } from "../services/subscriptionService";
import { stopThinkingCueLoop } from "../audio/soundCues";
import { canUserEndMeeting } from "../utils/meetingPermissions";
import {
  getNextAvailableAt,
  getRollingUsageForGuild,
  getRollingWindowMs,
} from "../services/meetingUsageService";
import { withMeetingEndTrace } from "../observability/meetingTrace";
import { evaluateAutoRecordCancellation } from "../services/autoRecordCancellationService";
import { meetingsCancelled } from "../metrics";
import { describeAutoRecordRule } from "../utils/meetingLifecycle";
import { deleteMeeting, getMeeting, hasMeeting } from "../meetings";
import { MEETING_END_REASONS, MEETING_STATUS } from "../types/meetingLifecycle";
import {
  cleanupMeetingTempDir,
  ensureMeetingTempDir,
} from "../services/tempFileService";

type EndMeetingFlowOptions = {
  client: Client;
  meeting: MeetingData;
  sendEndEmbed: (
    chatLogFilePath: string,
    splitFiles: ChunkInfo[],
  ) => Promise<void>;
  acknowledge?: () => Promise<void>;
};

export async function handleEndMeetingButton(
  client: Client,
  interaction: ButtonInteraction,
) {
  const guildId = interaction.guildId!;

  const meeting = getMeeting(guildId);

  try {
    if (!meeting) {
      await interaction.reply("No active meeting to end in this channel.");
      return;
    }

    if (!canUserEndMeeting(meeting, interaction.user.id)) {
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

    meeting.endReason = MEETING_END_REASONS.BUTTON;
    meeting.endTriggeredByUserId = interaction.user.id;

    await withMeetingEndTrace(meeting, async () => {
      await runEndMeetingFlow({
        client,
        meeting,
        acknowledge: async () => {
          await interaction.deferReply();
        },
        sendEndEmbed: async (chatLogFilePath, splitFiles) => {
          await sendMeetingEndEmbed(
            meeting,
            interaction,
            chatLogFilePath,
            splitFiles,
          );
        },
      });
    });
  } catch (error) {
    console.error("Error during meeting end:", error);
    if (meeting && hasMeeting(meeting.guildId)) {
      meeting.setFinished();
      meeting.finished = true;
      deleteMeeting(meeting.guildId);
    }
    if (meeting) {
      await cleanupMeetingTempDir(meeting);
    }
  }
}

export async function handleEndMeetingOther(
  client: Client,
  meeting: MeetingData,
) {
  try {
    await withMeetingEndTrace(meeting, async () => {
      await runEndMeetingFlow({
        client,
        meeting,
        sendEndEmbed: async (chatLogFilePath, splitFiles) => {
          await sendMeetingEndEmbedToChannel(
            meeting,
            meeting.textChannel,
            chatLogFilePath,
            splitFiles,
          );
        },
      });
    });
  } catch (error) {
    console.error("Error during meeting end:", error);
    if (meeting && hasMeeting(meeting.guildId)) {
      meeting.setFinished();
      meeting.finished = true;
      deleteMeeting(meeting.guildId);
    }
    await cleanupMeetingTempDir(meeting);
  }
}

async function runEndMeetingFlow(options: EndMeetingFlowOptions) {
  const { client, meeting, sendEndEmbed, acknowledge } = options;
  if (meeting.finishing || meeting.finished) {
    return;
  }
  if (meeting.timeoutTimer) {
    clearTimeout(meeting.timeoutTimer);
    meeting.timeoutTimer = undefined;
  }

  meeting.finishing = true;
  meeting.endTime = new Date();
  if (!meeting.endReason) {
    meeting.endReason = MEETING_END_REASONS.UNKNOWN;
  }
  await markMeetingProcessing(meeting);
  stopThinkingCueLoop(meeting);
  meeting.ttsQueue?.stopAndClear();

  if (acknowledge) {
    await acknowledge();
  }

  if (meeting.initialInteraction) {
    try {
      await meeting.initialInteraction.editReply({
        components: [],
      }); // Remove "End Meeting" button from initial reply if able
    } catch (e) {
      console.error(
        "Initial Interaction timed out, couldn't remove End Meeting button from initial reply, continuing...",
        e,
      );
    }
  }

  await clearStartMessageComponents(meeting);

  const meetingTempDir = await ensureMeetingTempDir(meeting);
  try {
    const chatLogFilePath = path.join(
      meetingTempDir,
      `chatlog-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`,
    );
    writeFileSync(
      chatLogFilePath,
      meeting.chatLog.map((e) => renderChatEntryLine(e)).join("\n"),
    );

    // checking if the current snippet exists should only matter when there was no audio recorded at all
    meeting.audioData.currentSnippets.forEach((snippet) => {
      startProcessingSnippet(meeting, snippet.userId);
    });

    if (meeting.connection) {
      meeting.connection.disconnect();
      meeting.connection.destroy();
    }

    await waitForAudioOnlyFinishProcessing(meeting);

    await closeOutputFile(meeting);

    const cancellationDecision = await evaluateAutoRecordCancellation(meeting);
    if (cancellationDecision.cancel) {
      meeting.cancelled = true;
      meeting.cancellationReason = cancellationDecision.reason;
      meeting.endReason = MEETING_END_REASONS.AUTO_CANCELLED;
      await handleAutoRecordCancellation(meeting, chatLogFilePath);
      await cleanupAudioSegments(meeting);
      return;
    }

    const combinedAudioFile = meeting.audioData.outputFileName!;
    const mixedAudioFile = await buildMixedAudio(meeting);
    const outputAudioFile = mixedAudioFile ?? combinedAudioFile;

    const splitAudioDir = path.join(meetingTempDir, "split");
    const splitFiles = await splitAudioIntoChunks(
      outputAudioFile,
      splitAudioDir,
    );

    await sendEndEmbed(chatLogFilePath, splitFiles);

    let transcriptForUpload: string | undefined;
    const transcriptionsReady = meeting.audioData.audioFiles.every(
      (file) => !file.processing,
    );

    if (meeting.transcribeMeeting) {
      let waitingForTranscriptionsMessage:
        | Awaited<ReturnType<typeof meeting.textChannel.send>>
        | undefined;
      if (!transcriptionsReady) {
        waitingForTranscriptionsMessage = await meeting.textChannel.send(
          "Processing transcription... please wait...",
        );
        await waitForFinishProcessing(meeting);
      }

      const transcriptions = await compileTranscriptions(client, meeting);
      meeting.finalTranscript = transcriptions;

      const transcriptionFilePath = path.join(
        meetingTempDir,
        `transcription-${meeting.guildId}-${meeting.channelId}-${Date.now()}.txt`,
      );
      writeFileSync(transcriptionFilePath, transcriptions);

      await sendTranscriptionFiles(meeting, transcriptionFilePath);

      deleteIfExists(transcriptionFilePath);

      if (waitingForTranscriptionsMessage) {
        await waitingForTranscriptionsMessage.delete();
      }

      if (meeting.finalTranscript && meeting.generateNotes) {
        const waitingForMeetingNotesMessage = await meeting.textChannel.send(
          "Generating meeting notes... please wait...",
        );
        await generateAndSendNotes(meeting);
        await waitingForMeetingNotesMessage.delete();
      }

      transcriptForUpload = await compileTranscriptions(client, meeting, {
        includeCues: true,
      });
    }

    // Upload artifacts after transcript generation (or audio/chat only)
    await uploadMeetingArtifacts(meeting, {
      audioFilePath: outputAudioFile,
      chatFilePath: chatLogFilePath,
      transcriptText: transcriptForUpload,
    });

    deleteIfExists(chatLogFilePath);
    deleteIfExists(outputAudioFile);
    if (mixedAudioFile && mixedAudioFile !== combinedAudioFile) {
      deleteIfExists(combinedAudioFile);
    }
    await cleanupAudioSegments(meeting);

    // Save meeting history to database before cleanup
    await saveMeetingHistoryToDatabase(meeting);
    await maybeSendMinutesLimitNotice(meeting);

    meeting.setFinished();
    meeting.finished = true;
    deleteMeeting(meeting.guildId);
  } finally {
    await cleanupMeetingTempDir(meeting);
  }
}

async function handleAutoRecordCancellation(
  meeting: MeetingData,
  chatLogFilePath: string,
) {
  meetingsCancelled.inc();
  await updateAutoRecordCancelledMessage(meeting);
  await deleteTrackedMessages(meeting);
  deleteIfExists(chatLogFilePath);
  if (meeting.audioData.outputFileName) {
    deleteIfExists(meeting.audioData.outputFileName);
  }
  await saveMeetingHistoryToDatabase(meeting);
  meeting.setFinished();
  meeting.finished = true;
  deleteMeeting(meeting.guildId);
}

async function deleteTrackedMessages(meeting: MeetingData) {
  const messageIds = meeting.messagesToDelete ?? [];
  if (messageIds.length === 0) return;
  await Promise.all(
    messageIds.map(async (messageId) => {
      try {
        const message = await meeting.textChannel.messages.fetch(messageId);
        await message.delete();
      } catch (error) {
        console.warn("Failed to delete auto-record notice message", error);
      }
    }),
  );
}

async function updateAutoRecordCancelledMessage(meeting: MeetingData) {
  const triggerLabel = meeting.startTriggeredByUserId
    ? `<@${meeting.startTriggeredByUserId}>`
    : "Unknown";
  const ruleLabel = describeAutoRecordRule(
    meeting.autoRecordRule,
    meeting.voiceChannel.name,
  );
  const reason =
    meeting.cancellationReason ??
    "Not enough content detected to keep this meeting.";
  const trimmedReason =
    reason.length > 700 ? `${reason.slice(0, 697)}...` : reason;

  const embed = new EmbedBuilder()
    .setTitle("Auto-Recording Cancelled")
    .setDescription(
      "Auto-recording started and was cancelled due to lack of content.",
    )
    .addFields(
      { name: "Triggered by", value: triggerLabel },
      { name: "Rule", value: ruleLabel },
      { name: "Reason", value: trimmedReason },
    )
    .setColor(0x6c757d)
    .setTimestamp();

  if (meeting.startMessageId) {
    try {
      const message = await meeting.textChannel.messages.fetch(
        meeting.startMessageId,
      );
      await message.edit({ embeds: [embed], components: [] });
      return;
    } catch (error) {
      console.warn("Failed to update auto-record start message", error);
    }
  }

  try {
    await meeting.textChannel.send({ embeds: [embed] });
  } catch (error) {
    console.warn("Failed to send auto-record cancellation message", error);
  }
}

async function markMeetingProcessing(meeting: MeetingData) {
  if (!meeting.transcribeMeeting) return;
  try {
    await updateMeetingStatusService({
      guildId: meeting.guildId,
      channelId_timestamp: `${meeting.voiceChannel.id}#${meeting.startTime.toISOString()}`,
      status: MEETING_STATUS.PROCESSING,
    });
  } catch (error) {
    console.warn("Failed to mark meeting as processing", error);
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
