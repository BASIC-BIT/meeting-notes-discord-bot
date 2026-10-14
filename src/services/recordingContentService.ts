import { liveTranscriptionProcessingSettings } from "./transcriptionProcessingSettings";
import {
  freezeCompletionPolicy,
  completionSnapshot,
} from "./meetingCompletionPolicyService";
import { createHash } from "node:crypto";
import type { MeetingData } from "../types/meeting-data";
import type { RecordingCaptureProvenance } from "../types/recordingCheckpoint";
import {
  generationContextSchema,
  completedTranscriptionSchema,
  savedRecordingSettingsSchema,
  type GenerationContextCheckpoint,
  type SavedRecordingSettings,
} from "../types/recordingContent";
import {
  collectMeetingContext,
  formatContextForPrompt,
} from "./contextService";
import { config } from "./configService";
import { getMeetingModelOverrides } from "./meetingModelOverrides";
import { getModelChoice } from "./modelFactory";
import { resolveChatParamsForRole } from "./openaiModelParams";
import { snapshotRecordingPrompt } from "./savedRecordingPrompt";
import {
  formatChatLogForPrompt,
  formatParticipantRoster,
  formatRoleRoster,
  isMentionableRole,
  selectRolesForPrompt,
} from "./notesPromptService";
import { resolveMeetingAttendees } from "../utils/meetingAttendees";
import { formatParticipantLabel } from "../utils/participants";
import { getBotNameVariants } from "../utils/botNames";
import { resolveAudioFileText } from "../utils/audioTranscript";
import { listRecentMeetingNamesForPrompt } from "./meetingNameService";

type Frozen = Pick<
  GenerationContextCheckpoint,
  "capture" | "settings" | "context" | "prompts" | "recentMeetingNames"
> & { sequence: number };
const snapshots = new WeakMap<MeetingData, Frozen>();
function provenance(meeting: MeetingData): RecordingCaptureProvenance {
  const reservation = meeting.reservation;
  if (
    !reservation ||
    reservation.sessionMode !== "meeting" ||
    !meeting.captureStartedAt
  )
    throw new Error("Recording capture is not attached");
  return {
    ...reservation.historyKey,
    meetingId: reservation.meetingId,
    channelId: meeting.channelId,
    ownerInstanceId: reservation.ownerInstanceId,
    executionVersion: reservation.executionVersion,
    reservedAt: new Date(reservation.reservedAt).toISOString(),
    captureStartedAt: meeting.captureStartedAt.toISOString(),
    requested: {
      transcribeMeeting: meeting.transcribeMeeting,
      generateNotes: meeting.generateNotes,
    },
  };
}
function settings(meeting: MeetingData): SavedRecordingSettings {
  const runtime = meeting.runtimeConfig;
  if (!runtime) throw new Error("Original recording settings unavailable");
  const model = (
    role:
      | "notes"
      | "meetingSummary"
      | "transcription"
      | "transcriptionCleanup"
      | "transcriptionCoalesce",
  ) => {
    const choice = getModelChoice(role, getMeetingModelOverrides(meeting));
    return {
      ...choice,
      params:
        role === "transcription"
          ? {}
          : resolveChatParamsForRole({
              role,
              model: choice.model,
              config: runtime.modelParams?.[role],
            }),
    };
  };
  return savedRecordingSettingsSchema.parse({
    autoCompletion: freezeCompletionPolicy(meeting),
    processing: liveTranscriptionProcessingSettings,
    models: {
      notes: model("notes"),
      meetingSummary: model("meetingSummary"),
      transcription: model("transcription"),
      transcriptionCleanup: model("transcriptionCleanup"),
      transcriptionCoalesce: model("transcriptionCoalesce"),
    },
    transcription: runtime.transcription,
    premiumTranscription: runtime.premiumTranscription,
    dictionary: runtime.dictionary,
    visionCaptions: runtime.visionCaptions,
    notes: {
      longStoryTestMode: config.notes.longStoryTestMode,
      longStoryTargetChars: config.notes.longStoryTargetChars,
      contextTestMode: config.context.testMode,
      enableMemory: config.context.enableMemory,
      memoryDepth: config.context.memoryDepth,
      maxContextLength: config.context.maxContextLength,
    },
  });
}
function snapshotDynamic(
  meeting: MeetingData,
  frozen: Frozen,
): GenerationContextCheckpoint {
  const participants = Array.from(meeting.participants.values(), (p) => ({
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    serverNickname: p.serverNickname,
    tag: p.tag,
    roleIds: p.roleIds,
  }));
  const roles = meeting.guild.roles
    .valueOf()
    .filter((role) => isMentionableRole(role, meeting.guildId))
    .map((role) => ({ id: role.id, name: role.name }));
  return generationContextSchema.parse({
    schemaVersion: 1,
    kind: "generation_context",
    capture: frozen.capture,
    capturedAt: new Date().toISOString(),
    completion: completionSnapshot(meeting),
    captureIncomplete: meeting.audioData.captureIncomplete,
    creatorId: meeting.creator.id,
    serverName: meeting.guild.name,
    serverDescription: meeting.guild.description ?? "",
    voiceChannelName: meeting.voiceChannel.name,
    events: meeting.guild.scheduledEvents
      .valueOf()
      .map((event) => event.name)
      .join(", "),
    channelNames: meeting.guild.channels
      .valueOf()
      .map((channel) => channel.name)
      .join(", "),
    botDisplayName:
      meeting.guild.members.me?.displayName ||
      meeting.guild.members.me?.nickname ||
      meeting.guild.members.me?.user.username ||
      "Meeting Notes Bot",
    botNames: getBotNameVariants(
      meeting.guild.members.me,
      meeting.guild.client.user,
    ),
    tags: [...(meeting.tags ?? [])],
    participants,
    attendance: [...meeting.attendance],
    mentionableRoles: roles,
    promptVisibleRoleIds: selectRolesForPrompt(roles, participants).map(
      (role) => role.id,
    ),
    participantRoster:
      formatParticipantRoster(
        participants,
        new Map(roles.map((role) => [role.id, role.name])),
      ) ?? "No participant roster captured.",
    roleRoster: formatRoleRoster(roles, participants),
    cleanupRoleNames: meeting.guild.roles
      .valueOf()
      .map((role) => role.name)
      .join(", "),
    attendees: resolveMeetingAttendees(meeting).join(", "),
    chatContext:
      formatChatLogForPrompt({
        chatLog: meeting.chatLog,
        runtimeConfig:
          frozen.settings.availability === "available" && meeting.runtimeConfig
            ? {
                ...meeting.runtimeConfig,
                visionCaptions: frozen.settings.value.visionCaptions,
              }
            : undefined,
      }) ?? "",
    settings: frozen.settings,
    context: frozen.context,
    prompts: frozen.prompts,
    recentMeetingNames: frozen.recentMeetingNames,
  });
}
function enqueue(
  meeting: MeetingData,
  frozen: Frozen,
  kind: "context" | "transcription",
  payload: unknown,
) {
  const bytes = Buffer.from(JSON.stringify(payload));
  meeting.recordingCapture?.queueContent({
    kind,
    sourceId: kind,
    sequence: frozen.sequence++,
    contentType: "application/json",
    coverage: { kind: "unknown" },
    bytes,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
export function checkpointRecordingContext(meeting: MeetingData): void {
  const frozen = snapshots.get(meeting);
  if (!frozen || !meeting.recordingCapture) return;
  enqueue(meeting, frozen, "context", snapshotDynamic(meeting, frozen));
}
export function checkpointCompletedTranscription(
  meeting: MeetingData,
  processing?: import("../types/recordingContent").CompletedTranscriptionCheckpoint["processing"],
): void {
  const frozen = snapshots.get(meeting);
  if (!frozen || !frozen.capture.requested.transcribeMeeting) return;
  const completedAt = new Date().toISOString();
  const entries = meeting.audioData.audioFiles.flatMap((file) => {
    const text = resolveAudioFileText(file);
    if (file.transcriptionFailed || !text?.trim()) return [];
    return [
      {
        sourceId: `${file.source === "bot" || file.source === "chat_tts" ? "bot" : "user"}:${file.userId}`,
        userId: file.userId,
        source: file.source ?? "voice",
        timestamp: file.timestamp,
        text,
        speakerLabel: formatParticipantLabel(
          meeting.participants.get(file.userId),
          { includeUsername: true, fallbackName: file.userId },
        ),
        completedAt,
        revision: file.fastTranscripts?.length ?? 0,
      },
    ];
  });
  if (!entries.length) return;
  const payload = completedTranscriptionSchema.parse({
    schemaVersion: 1,
    kind: "completed_transcription",
    processing,
    capture: frozen.capture,
    capturedAt: completedAt,
    entries,
  });
  checkpointRecordingContext(meeting);
  enqueue(meeting, frozen, "transcription", payload);
}
async function capturePrompts(
  frozen: Frozen,
  names: Array<[keyof Frozen["prompts"], string, "text" | "chat"]>,
  label: string,
) {
  await Promise.all(
    names.map(async ([role, name, type]) => {
      try {
        frozen.prompts[role] = {
          availability: "available",
          value: await snapshotRecordingPrompt(name, type, label),
        };
      } catch {
        frozen.prompts[role] = { availability: "unavailable" };
      }
    }),
  );
}
async function captureContext(
  meeting: MeetingData,
  frozen: Frozen,
  effective: SavedRecordingSettings,
  signal: AbortSignal,
) {
  const result = await collectMeetingContext(
    meeting,
    effective.notes.enableMemory,
    { signal, strict: true, memoryDepth: effective.notes.memoryDepth },
  );
  const data = result.data;
  frozen.context = {
    availability: result.availability,
    meetingContext: data.meetingContext,
    serverContext: data.serverContext,
    channelContext: data.channelContext,
    recentMeetings: (data.recentMeetings ?? []).map((row) => ({
      timestamp: row.timestamp,
      context: row.context,
      notes: row.notes,
    })),
    dictionaryEntries: (data.dictionaryEntries ?? []).map((item) => ({
      term: item.term,
      definition: item.definition,
      updatedAt: item.updatedAt,
    })),
    transcriptionFormattedContext: formatContextForPrompt(
      data,
      "transcription",
      effective.notes.maxContextLength,
    ),
    transcriptionMaxContextLength: effective.notes.maxContextLength,
    formattedContext: formatContextForPrompt(
      data,
      "notes",
      effective.notes.maxContextLength,
    ),
  };
  if (frozen.capture.requested.generateNotes) {
    try {
      frozen.recentMeetingNames = {
        availability: "available",
        value: await listRecentMeetingNamesForPrompt({
          guildId: meeting.guildId,
          excludeMeetingId: meeting.meetingId,
          signal,
        }),
      };
    } catch {
      frozen.recentMeetingNames = { availability: "unavailable" };
    }
  }
}
/** The actual bounded lookup promise is exposed to R3; capture never awaits it. */
export function startRecordingContentCheckpoint(meeting: MeetingData): void {
  if (
    snapshots.has(meeting) ||
    !meeting.recordingCapture ||
    !meeting.ownershipSignal
  )
    return;
  const frozen: Frozen = {
    capture: provenance(meeting),
    sequence: 0,
    settings: { availability: "unavailable" },
    prompts: {},
    recentMeetingNames: { availability: "unavailable" },
    context: {
      availability: "unavailable",
      meetingContext: meeting.meetingContext,
      recentMeetings: [],
      dictionaryEntries: [],
      formattedContext: "",
    },
  };
  snapshots.set(meeting, frozen);
  const names: Array<[keyof Frozen["prompts"], string, "text" | "chat"]> = [];
  let effective: SavedRecordingSettings;
  try {
    effective = settings(meeting);
    frozen.settings = { availability: "available", value: effective };
  } catch {
    checkpointRecordingContext(meeting);
    return;
  }
  if (frozen.capture.requested.transcribeMeeting) {
    names.push([
      "transcription",
      config.langfuse.transcriptionPromptName,
      "text",
    ]);
    if (effective.premiumTranscription.cleanupEnabled)
      names.push([
        "cleanup",
        config.langfuse.transcriptionCleanupPromptName,
        "chat",
      ]);
    if (effective.premiumTranscription.enabled)
      names.push([
        "coalesce",
        config.langfuse.transcriptionCoalescePromptName,
        "chat",
      ]);
    if (effective.transcription.finalPassEnabled)
      names.push([
        "finalPass",
        config.langfuse.transcriptionFinalPassPromptName,
        "chat",
      ]);
    if (frozen.capture.requested.generateNotes) {
      names.push(
        [
          "notes",
          effective.notes.longStoryTestMode
            ? config.langfuse.notesLongStoryPromptName
            : effective.notes.contextTestMode
              ? config.langfuse.notesContextTestPromptName
              : config.langfuse.notesPromptName,
          "chat",
        ],
        ["summary", config.langfuse.meetingSummaryPromptName, "chat"],
      );
    }
  }
  for (const [role] of names)
    frozen.prompts[role] = { availability: "unavailable" };
  checkpointRecordingContext(meeting);
  const signal = AbortSignal.any([
    meeting.ownershipSignal,
    AbortSignal.timeout(5000),
  ]);
  meeting.recordingContentTask = Promise.allSettled([
    captureContext(meeting, frozen, effective, signal),
    capturePrompts(frozen, names, config.langfuse.promptLabel),
  ])
    .then(() => {
      if (!meeting.ownershipSignal?.aborted)
        checkpointRecordingContext(meeting);
    })
    .catch(() => {
      /* Initial explicit unavailable snapshot remains canonical. */
    });
}
