import { ButtonInteraction, Client, EmbedBuilder } from "discord.js";
import { settleOwnedVoiceSession } from "../services/guildVoiceOperationService";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildMixedAudio,
  cleanupSpeakerTracks,
  closeOutputFile,
  closeFailedInitializationOutput,
  compileTranscriptions,
  startProcessingSnippet,
  waitForAudioOnlyFinishProcessing,
  waitForFinishProcessing,
} from "../audio";
import {
  updateMeetingProcessingMessage,
  updateMeetingSummaryMessage,
  updateMeetingMessage,
} from "../embed";
import { deleteIfExists } from "../util";
import { MeetingData } from "../types/meeting-data";
import { saveMeetingHistoryToDatabase } from "./saveMeetingHistory";
import { transitionOwnedMeetingHistoryService } from "../services/meetingHistoryService";
import { renderChatEntryLine } from "../utils/chatLog";
import {
  uploadMeetingArtifacts,
  type UploadMeetingArtifactsResult,
} from "../services/uploadService";
import { notifyRecordingLimit } from "../services/recordingLimitService";
import { getGuildLimits } from "../services/subscriptionService";
import { stopThinkingCueLoop } from "../audio/soundCues";
import { canUserEndMeeting } from "../utils/meetingPermissions";
import {
  getNextAvailableAt,
  getRollingUsageForGuild,
  getRollingWindowMs,
} from "../services/meetingUsageService";
import {
  withMeetingEndTrace,
  withMeetingEndStep,
  type MeetingEndStepOptions,
} from "../observability/meetingTrace";
import { evaluateAutoRecordCancellation } from "../services/autoRecordCancellationService";
import { autoRecordJoinSuppressionService } from "../services/autoRecordJoinSuppressionService";
import { meetingsCancelled } from "../metrics";
import { captureEvent } from "../services/analyticsService";
import {
  describeAutoRecordRule,
  resolveMeetingActorId,
} from "../utils/meetingLifecycle";
import {
  deleteMeeting,
  endTtsOnlySession,
  getMeeting,
  restoreVoiceSessionNickname,
} from "../meetings";
import { MEETING_END_REASONS, MEETING_STATUS } from "../types/meetingLifecycle";
import {
  ensureMeetingNotes,
  ensureMeetingSummaries,
} from "../services/meetingNotesService";
import { captionMeetingImages } from "../services/imageCaptionService";
import {
  cleanupMeetingTempDir,
  ensureMeetingTempDir,
  getMeetingTempDir,
  retainMeetingTempDir,
} from "../services/tempFileService";
import { releaseMeetingLeaseForMeeting } from "../services/activeMeetingLeaseService";
import { runTranscriptionFinalPass } from "../services/transcriptionFinalPassService";
import { getAudioTranscriptionFacts } from "../utils/audioTranscript";
import {
  runOwnedMeetingFinalization,
  assertMeetingFinalizationActive,
} from "../services/meetingFinalizationService";
import {
  classifyTranscription,
  assertMeetingProcessingSucceeded,
} from "../utils/meetingProcessing";

export type EndMeetingFlowOptions = {
  client: Client;
  meeting: MeetingData;
};

const DISMISSED_AUTO_RECORD_COMPLETE_MIN_DURATION_MS = 10 * 60 * 1000;
const DISMISSED_AUTO_RECORD_COMPLETE_MIN_CHAT_MESSAGES = 2;

async function runMeetingEndStep<T>(
  meeting: MeetingData,
  name: string,
  run: () => Promise<T>,
  options: MeetingEndStepOptions = {},
): Promise<T> {
  assertMeetingFinalizationActive(meeting);
  const startedAt = Date.now();
  const result = await withMeetingEndStep(meeting, name, run, options);
  assertMeetingFinalizationActive(meeting);
  const durationMs = Date.now() - startedAt;
  console.log(`Meeting end step completed: ${name} durationMs=${durationMs}`);
  return result;
}

/**
 * Counts and flags only. Notes, transcript, and chat content are user data and
 * must not leave the system as event properties.
 *
 * Reading the meeting to build those properties happens inside the guard on
 * purpose. This runs on a finalization path, so an unexpected shape here would
 * otherwise throw into the caller's error cleanup and tear down a meeting that
 * had already finished, for the sake of an analytics event.
 *
 * Called from both finalization paths. A cancelled auto-recording finishes
 * through its own branch, and skipping it there would leave those meetings
 * emitting meeting_started with no completion, so ordinary cancellation would
 * read as funnel abandonment.
 */
function hasUsableMeetingNotes(meeting: MeetingData): boolean {
  return (
    !meeting.cancelled &&
    meeting.processing?.transcription === "ready" &&
    meeting.processing?.notes === "generated" &&
    Boolean(meeting.notesText?.trim()) &&
    meeting.historySaved === true &&
    meeting.delivery?.notes?.outcome === "complete"
  );
}

function captureMeetingCompleted(meeting: MeetingData): void {
  try {
    const endTime = meeting.endTime ?? new Date();
    captureEvent("meeting_completed", {
      userId: resolveMeetingActorId(meeting),
      guildId: meeting.guildId,
      properties: {
        duration_ms: endTime.getTime() - meeting.startTime.getTime(),
        attendee_count: meeting.attendance.size,
        end_reason: meeting.endReason ?? MEETING_END_REASONS.UNKNOWN,
        trigger: meeting.startReason,
        transcribed: meeting.transcribeMeeting,
        notes_generated: meeting.generateNotes,
        cancelled: Boolean(meeting.cancelled),
        event_version: 2,
        surface: "discord",
        transcription_outcome: meeting.processing?.transcription ?? "unknown",
        notes_outcome: meeting.processing?.notes ?? "unknown",
        history_persistence:
          meeting.historySaved === undefined
            ? "unknown"
            : meeting.historySaved
              ? "saved"
              : "not_saved",
        notes_delivery: meeting.delivery?.notes?.outcome ?? "unknown",
        usable_notes: hasUsableMeetingNotes(meeting),
      },
    });
  } catch (error) {
    console.warn("Failed to capture meeting_completed", {
      meetingId: meeting.meetingId,
      error,
    });
  }
}

function shouldFinalizeDismissedAutoRecording(meeting: MeetingData): boolean {
  if (!meeting.cancelled) return false;
  if (!meeting.isAutoRecording) return false;
  if (meeting.endReason !== MEETING_END_REASONS.DISMISSED) return false;
  if (!meeting.endTime) {
    throw new Error(
      "Dismissed auto-record finalization requires meeting.endTime",
    );
  }

  const durationMs = meeting.endTime.getTime() - meeting.startTime.getTime();
  if (durationMs >= DISMISSED_AUTO_RECORD_COMPLETE_MIN_DURATION_MS) {
    return true;
  }

  const chatMessageCount = meeting.chatLog.filter(
    (entry) => entry.type === "message",
  ).length;
  return chatMessageCount >= DISMISSED_AUTO_RECORD_COMPLETE_MIN_CHAT_MESSAGES;
}

function hasMissingExpectedArtifacts(
  result: UploadMeetingArtifactsResult,
): boolean {
  return (
    (result.audioUploadExpected && !result.audioS3Key) ||
    (result.chatUploadExpected && !result.chatS3Key) ||
    (result.transcriptUploadExpected && !result.transcriptS3Key)
  );
}

async function retainLocalMeetingArtifacts(
  meeting: MeetingData,
  reason: string,
): Promise<void> {
  const retainedTempDir = await retainMeetingTempDir(meeting, reason);
  const localPath = retainedTempDir ?? getMeetingTempDir(meeting);
  console.error(
    "Expected meeting artifacts were not durably uploaded; retained local artifacts",
    {
      guildId: meeting.guildId,
      meetingId: meeting.meetingId,
      reason,
      localPath,
    },
  );
}

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

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    await withMeetingEndTrace(meeting, async () => {
      await runEndMeetingFlow({ client, meeting });
    });
  } catch (error) {
    console.error("Error during meeting end:", error);
  }
}

export async function handleEndMeetingOther(
  client: Client,
  meeting: MeetingData,
) {
  try {
    await withMeetingEndTrace(meeting, async () => {
      await runEndMeetingFlow({ client, meeting });
    });
  } catch (error) {
    console.error("Error during meeting end:", error);
  }
}

/** Returns the same promise for every button, remote request and timeout. */
export function runEndMeetingFlow(
  options: EndMeetingFlowOptions,
): Promise<void> {
  const { meeting } = options;
  if (meeting.sessionMode === "tts_only") return endTtsOnlySession(meeting);
  return runOwnedMeetingFinalization(meeting, () =>
    executeOwnedFinalization(options),
  );
}

export function getMeetingFinalizationCheckpoint(meeting: MeetingData) {
  return {
    promise: meeting.finalization?.promise,
    disposition: meeting.finalization?.disposition ?? "pending",
    historyDisposition: meeting.finalization?.historyDisposition,
    fenced:
      meeting.finalizationFenced === true ||
      meeting.ownershipSignal?.aborted === true,
    preservation: meeting.finalization?.preservation,
  };
}

/** R3 can fence late AI results before running preservation under its shared deadline. */
export function fenceMeetingFinalization(meeting: MeetingData): void {
  meeting.finalizationFenced = true;
  if (meeting.finalization) meeting.finalization.disposition = "unresolved";
  meeting.finalization?.controller.abort(
    new Error("Meeting finalization fenced"),
  );
  stopFinalizationCapture(meeting);
}

function stopFinalizationCapture(meeting: MeetingData): void {
  meeting.finishing = true;
  meeting.captureAudio = false;
  meeting.recordBotAudio = false;
  meeting.ttsQueue?.stopAndClear();
  stopThinkingCueLoop(meeting);
  if (meeting.timeoutTimer) clearTimeout(meeting.timeoutTimer);
  meeting.reservation?.workHandle.transition("finalization");
}

/** Stops local capture without invoking notes/AI or deleting artifacts. False remains owned. */
export function preserveMeetingFinalizationCapture(
  meeting: MeetingData,
): Promise<boolean> {
  fenceMeetingFinalization(meeting);
  const existing = meeting.finalization?.preservation;
  if (existing) return existing;
  const preservation = preserveStoppedCapture(meeting);
  if (meeting.finalization) meeting.finalization.preservation = preservation;
  return preservation;
}

function preserveStoppedCapture(meeting: MeetingData): Promise<boolean> {
  return Promise.all([
    closeFailedInitializationOutput(meeting),
    meeting.reservation
      ? settleOwnedVoiceSession(meeting.reservation)
      : Promise.resolve("uncertain"),
  ])
    .then(([closed, voice]) => closed && voice === "settled")
    .catch(() => false);
}

async function executeOwnedFinalization(
  options: EndMeetingFlowOptions,
): Promise<void> {
  const { meeting } = options;
  try {
    assertMeetingFinalizationActive(meeting);
    await finalizeRecording(options);
    assertMeetingFinalizationActive(meeting);
    if (meeting.finalization?.disposition !== "durable")
      throw new Error("Meeting artifacts require preservation");
    await cleanupMeetingTempDir(meeting);
    assertMeetingFinalizationActive(meeting);
    const released = await releaseMeetingLeaseForMeeting(meeting);
    if (!released)
      throw new Error("Meeting voice or lease release remains unresolved");
    assertMeetingFinalizationActive(meeting);
    meeting.setFinished();
    meeting.finished = true;
    captureMeetingCompleted(meeting);
    deleteMeeting(meeting.guildId);
  } catch (error) {
    if (meeting.finalization) meeting.finalization.disposition = "unresolved";
    stopFinalizationCapture(meeting);
    // Close capture/voice even when the history provider cannot return.
    const preservation = preserveStoppedCapture(meeting);
    if (meeting.finalization) meeting.finalization.preservation = preservation;
    // Failure is a durable disposition, never evidence that local artifacts can be deleted.
    try {
      await transitionOwnedMeetingHistoryService(
        meeting,
        {
          status: MEETING_STATUS.FAILED,
          processing: meeting.processing,
          endReason: meeting.endReason,
          audioS3Key: meeting.audioS3Key,
          chatS3Key: meeting.chatS3Key,
          transcriptS3Key: meeting.transcriptS3Key,
        },
        [
          MEETING_STATUS.STARTING,
          MEETING_STATUS.IN_PROGRESS,
          MEETING_STATUS.PROCESSING,
        ],
      );
      if (meeting.finalization)
        meeting.finalization.historyDisposition = "failed";
    } catch (historyError) {
      console.error("Meeting finalization disposition remains unresolved", {
        meetingId: meeting.meetingId,
        error: historyError,
      });
    }
    // A failed encoder/storage/provider leaves work counted for preservation/reconciliation.
    fenceMeetingFinalization(meeting);
    throw error;
  }
}

async function finalizeRecording(
  options: EndMeetingFlowOptions,
): Promise<void> {
  const { client, meeting } = options;
  if (meeting.timeoutTimer) {
    clearTimeout(meeting.timeoutTimer);
    meeting.timeoutTimer = undefined;
  }

  meeting.finishing = true;
  meeting.endTime = new Date();
  if (!meeting.endReason) {
    meeting.endReason = MEETING_END_REASONS.UNKNOWN;
  }
  const initialEndReason = meeting.endReason;
  await markMeetingProcessing(meeting);
  stopThinkingCueLoop(meeting);
  meeting.ttsQueue?.stopAndClear();

  await runMeetingEndStep(meeting, "update-processing-message", () =>
    updateMeetingProcessingMessage(meeting),
  );

  const meetingTempDir = await ensureMeetingTempDir(meeting);
  {
    const chatLogFilePath = path.join(meetingTempDir, "chat.txt");
    writeFileSync(
      chatLogFilePath,
      meeting.chatLog
        .map((e) => renderChatEntryLine(e, { includeAttachmentUrls: true }))
        .join("\n"),
    );

    // checking if the current snippet exists should only matter when there was no audio recorded at all
    meeting.audioData.currentSnippets.forEach((snippet) => {
      startProcessingSnippet(meeting, snippet.userId);
    });

    maybeSuppressAutoRecordRejoin(meeting, initialEndReason);

    if (meeting.connection) {
      if (meeting.reservation)
        await settleOwnedVoiceSession(meeting.reservation);
    }
    await runMeetingEndStep(meeting, "restore-bot-nickname", () =>
      restoreVoiceSessionNickname(meeting),
    );

    await runMeetingEndStep(meeting, "wait-audio-only", () =>
      waitForAudioOnlyFinishProcessing(meeting),
    );

    await runMeetingEndStep(meeting, "close-output-file", () =>
      closeOutputFile(meeting),
    );

    if (meeting.transcribeMeeting)
      await runMeetingEndStep(meeting, "wait-finalization-processing", () =>
        waitForFinishProcessing(meeting),
      );
    assertMeetingProcessingSucceeded(meeting);

    const finalizeDismissedAutoRecording =
      shouldFinalizeDismissedAutoRecording(meeting);
    if (finalizeDismissedAutoRecording) {
      meeting.cancelled = false;
      meeting.cancellationReason = undefined;
    }

    if (meeting.cancelled) {
      await runMeetingEndStep(meeting, "auto-record-cancel-flow", () =>
        handleAutoRecordCancellation(client, meeting, chatLogFilePath),
      );
      await runMeetingEndStep(meeting, "cleanup-speaker-tracks", () =>
        cleanupSpeakerTracks(meeting),
      );
      return;
    }

    if (!finalizeDismissedAutoRecording) {
      const cancellationDecision = await runMeetingEndStep(
        meeting,
        "auto-record-cancellation",
        () => evaluateAutoRecordCancellation(meeting),
        {
          metadata: {
            audioFiles: meeting.audioData.audioFiles.length,
          },
        },
      );
      assertMeetingProcessingSucceeded(meeting);
      if (cancellationDecision.cancel) {
        await runMeetingEndStep(meeting, "auto-record-cancel-flow", () =>
          handleAutoRecordCancellation(
            client,
            meeting,
            chatLogFilePath,
            cancellationDecision,
          ),
        );
        await runMeetingEndStep(meeting, "cleanup-speaker-tracks", () =>
          cleanupSpeakerTracks(meeting),
        );
        return;
      }
    }

    const combinedAudioFile = meeting.audioData.outputFileName!;
    const mixedAudioFile = await runMeetingEndStep(
      meeting,
      "build-mixed-audio",
      () => buildMixedAudio(meeting),
      {
        metadata: {
          speakerTrackCount: meeting.audioData.speakerTracks?.size ?? 0,
        },
      },
    );
    const outputAudioFile = mixedAudioFile ?? combinedAudioFile;

    let transcriptForUpload: string | undefined;
    const transcriptionsReady = meeting.audioData.audioFiles.every(
      (file) => !file.processing,
    );

    if (meeting.transcribeMeeting) {
      if (!transcriptionsReady) {
        const pending = meeting.audioData.audioFiles.filter(
          (file) => file.processing,
        ).length;
        console.log(
          `Waiting for transcriptions to finish: pending=${pending} meetingId=${meeting.meetingId}`,
        );
        await runMeetingEndStep(
          meeting,
          "wait-transcriptions",
          () => waitForFinishProcessing(meeting),
          {
            metadata: {
              pending,
            },
          },
        );
      }

      const finalPassResult = await runMeetingEndStep(
        meeting,
        "transcription-final-pass",
        () =>
          runTranscriptionFinalPass(meeting, {
            audioFilePath: outputAudioFile,
          }),
      );
      console.log("Transcription final pass completed.", {
        meetingId: meeting.meetingId,
        ...finalPassResult,
      });

      const transcriptions = await runMeetingEndStep(
        meeting,
        "compile-transcriptions",
        () => compileTranscriptions(client, meeting),
      );
      meeting.finalTranscript = transcriptions;
      const transcriptionStillPending = meeting.audioData.audioFiles.some(
        (file) => file.processing,
      );
      if (transcriptionStillPending) {
        console.error(
          "Cannot classify meeting transcription while required work is pending",
          { meetingId: meeting.meetingId },
        );
      }
      meeting.processing = {
        ...meeting.processing,
        transcription: transcriptionStillPending
          ? "failed"
          : classifyTranscription(
              getAudioTranscriptionFacts(meeting.audioData),
            ),
      };

      if (meeting.generateNotes) {
        await runMeetingEndStep(
          meeting,
          "caption-images",
          () => captionMeetingImages(meeting),
          {
            metadata: {
              chatEntries: meeting.chatLog.length,
            },
          },
        );
        const notes = await runMeetingEndStep(meeting, "generate-notes", () =>
          ensureMeetingNotes(meeting),
        );
        await runMeetingEndStep(meeting, "generate-summary", () =>
          ensureMeetingSummaries(meeting, notes),
        );
      }

      assertMeetingProcessingSucceeded(meeting);
      transcriptForUpload = await runMeetingEndStep(
        meeting,
        "compile-transcriptions-upload",
        () =>
          compileTranscriptions(client, meeting, {
            includeCues: true,
          }),
      );
    }

    // Upload artifacts after transcript generation (or audio/chat only)
    const uploadResult = await runMeetingEndStep(
      meeting,
      "upload-artifacts",
      () =>
        uploadMeetingArtifacts(meeting, {
          audioFilePath: outputAudioFile,
          chatFilePath: chatLogFilePath,
          transcriptText: transcriptForUpload,
        }),
    );
    if (hasMissingExpectedArtifacts(uploadResult)) {
      await runMeetingEndStep(meeting, "retain-local-artifacts", () =>
        retainLocalMeetingArtifacts(meeting, "artifact_upload_failed"),
      );
      throw new Error("Meeting artifact upload failed");
    }

    assertMeetingProcessingSucceeded(meeting);
    await runMeetingEndStep(meeting, "update-summary-message", () =>
      updateMeetingSummaryMessage(meeting),
    );

    // Save meeting history to database before cleanup
    await runMeetingEndStep(meeting, "save-meeting-history", () =>
      saveMeetingHistoryToDatabase(meeting),
    );
    if (meeting.finalization) {
      meeting.finalization.disposition = "durable";
      meeting.finalization.historyDisposition = "complete";
    }

    deleteIfExists(chatLogFilePath);
    deleteIfExists(outputAudioFile);
    if (outputAudioFile !== combinedAudioFile) {
      // Only delete the combined file when a separate mixed file was used.
      deleteIfExists(combinedAudioFile);
    }
    await runMeetingEndStep(meeting, "cleanup-speaker-tracks", () =>
      cleanupSpeakerTracks(meeting),
    );

    // Ancillary delivery stays in the same counted finalization until it settles.
    await runMeetingEndStep(meeting, "minutes-limit-notice", () =>
      maybeSendMinutesLimitNotice(meeting),
    ).catch((error) => {
      console.warn("Recording-limit notice failed", {
        guildId: meeting.guildId,
        error,
      });
    });
  }
}

function maybeSuppressAutoRecordRejoin(
  meeting: MeetingData,
  endReason: MeetingData["endReason"],
) {
  if (!meeting.isAutoRecording) return;
  if (
    endReason !== MEETING_END_REASONS.BUTTON &&
    endReason !== MEETING_END_REASONS.WEB_UI &&
    endReason !== MEETING_END_REASONS.MCP &&
    endReason !== MEETING_END_REASONS.LIVE_VOICE &&
    endReason !== MEETING_END_REASONS.DISMISSED
  ) {
    return;
  }
  const members = meeting.voiceChannel?.members;
  if (!members) return;
  const nonBotMemberIds = members
    .filter((member) => !member.user.bot)
    .map((member) => member.id);
  autoRecordJoinSuppressionService.suppressUntilEmpty({
    guildId: meeting.guildId,
    channelId: meeting.voiceChannel.id,
    nonBotMemberIds,
    reason: "explicit_end",
  });
}

async function handleAutoRecordCancellation(
  client: Client,
  meeting: MeetingData,
  chatLogFilePath: string,
  automaticDecision?: { reason?: string },
): Promise<void> {
  const uploadResult = await uploadCancelledMeetingArtifacts(
    client,
    meeting,
    chatLogFilePath,
  );
  if (hasMissingExpectedArtifacts(uploadResult)) {
    await retainLocalMeetingArtifacts(
      meeting,
      "cancelled_artifact_upload_failed",
    );
    throw new Error("Meeting artifact upload failed");
  }
  assertMeetingProcessingSucceeded(meeting);
  assertMeetingFinalizationActive(meeting);
  if (automaticDecision) {
    meeting.cancelled = true;
    meeting.cancellationReason = automaticDecision.reason;
    meeting.endReason = MEETING_END_REASONS.AUTO_CANCELLED;
  }
  await updateAutoRecordCancelledMessage(meeting);
  await deleteTrackedMessages(meeting);
  await saveMeetingHistoryToDatabase(meeting);
  assertMeetingFinalizationActive(meeting);
  meetingsCancelled.inc();
  if (meeting.finalization) {
    meeting.finalization.disposition = "durable";
    meeting.finalization.historyDisposition = "cancelled";
  }
  deleteIfExists(chatLogFilePath);
  if (meeting.audioData.outputFileName) {
    deleteIfExists(meeting.audioData.outputFileName);
  }
}

async function uploadCancelledMeetingArtifacts(
  client: Client,
  meeting: MeetingData,
  chatLogFilePath: string,
): Promise<UploadMeetingArtifactsResult> {
  let transcriptForUpload: string | undefined;

  if (meeting.transcribeMeeting) {
    // Cancelled-meeting uploads are best-effort recovery artifacts, so we skip
    // the slower final transcription pass that only runs for fully finalized meetings.
    const transcriptionsReady = meeting.audioData.audioFiles.every(
      (file) => !file.processing,
    );
    if (!transcriptionsReady) {
      const pending = meeting.audioData.audioFiles.filter(
        (file) => file.processing,
      ).length;
      console.log(
        `Waiting for cancelled meeting transcriptions to finish: pending=${pending} meetingId=${meeting.meetingId}`,
      );
      await runMeetingEndStep(meeting, "wait-cancelled-transcriptions", () =>
        waitForFinishProcessing(meeting),
      );
    }

    const transcriptions = await runMeetingEndStep(
      meeting,
      "compile-cancelled-transcriptions",
      () => compileTranscriptions(client, meeting),
    );
    meeting.finalTranscript = transcriptions;
    transcriptForUpload = transcriptions;
  }

  return await runMeetingEndStep(meeting, "upload-cancelled-artifacts", () =>
    uploadMeetingArtifacts(meeting, {
      audioFilePath: meeting.audioData.outputFileName,
      chatFilePath: chatLogFilePath,
      transcriptText: transcriptForUpload,
    }),
  );
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
  const wasDismissed = meeting.endReason === MEETING_END_REASONS.DISMISSED;
  const title = wasDismissed
    ? "Auto-Recording Stopped"
    : "Auto-Recording Cancelled";
  const description = wasDismissed
    ? "Auto-recording was stopped before the meeting finished."
    : "Auto-recording started and was cancelled.";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "Triggered by", value: triggerLabel },
      { name: "Rule", value: ruleLabel },
      { name: "Reason", value: trimmedReason },
    )
    .setColor(0x6c757d)
    .setTimestamp();

  await updateMeetingMessage(
    meeting,
    { embeds: [embed], components: [] },
    "cancellation",
  );
}

async function markMeetingProcessing(meeting: MeetingData) {
  await transitionOwnedMeetingHistoryService(
    meeting,
    { status: MEETING_STATUS.PROCESSING },
    [MEETING_STATUS.STARTING, MEETING_STATUS.IN_PROGRESS],
  );
}

async function maybeSendMinutesLimitNotice(meeting: MeetingData) {
  const resolved = await getGuildLimits(meeting.guildId);
  const { limits } = resolved;
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
    await notifyRecordingLimit(
      {
        guildId: meeting.guildId,
        userId: resolveMeetingActorId(meeting),
        limitType: "weekly_recording",
        limitSurface: "weekly_after_meeting",
        outcome: "exhausted_after_meeting",
        limitMinutes: limits.maxMeetingMinutesRolling,
        usedMinutes: usage.usedSeconds / 60,
        message: `This server has used its rolling-week recording allowance. ${nextLabel}`,
        resolved,
      },
      meeting.textChannel,
      meeting.recordingLimitNotice,
    );
    return;
  }

  if (remainingMinutes <= thresholdMinutes) {
    await notifyRecordingLimit(
      {
        guildId: meeting.guildId,
        userId: resolveMeetingActorId(meeting),
        limitType: "weekly_recording",
        limitSurface: "weekly_warning",
        outcome: "near_limit",
        limitMinutes: limits.maxMeetingMinutesRolling,
        usedMinutes: usage.usedSeconds / 60,
        message: `About ${remainingMinutes} ${remainingMinutes === 1 ? "minute remains" : "minutes remain"} in this server's rolling-week recording allowance.`,
        resolved,
      },
      meeting.textChannel,
      meeting.recordingLimitNotice,
    );
  }
}
