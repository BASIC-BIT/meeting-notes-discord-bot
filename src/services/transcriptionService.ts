import type OpenAI from "openai";
import type { TranscriptionCreateParamsNonStreaming } from "openai/resources/audio";
import {
  createReadStream,
  existsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { convertTranscriptionPcmToWav } from "./transcriptionAudioService";
import {
  bulkhead,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  wrap,
} from "cockatiel";
import Bottleneck from "bottleneck";
import type {
  AudioSnippet,
  SnippetTranscriptionResult,
  TranscriptVariant,
} from "../types/audio";
import type { MeetingData } from "../types/meeting-data";
import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  LANGFUSE_AUDIO_ATTACHMENT_MAX_CONCURRENT,
  LANGFUSE_AUDIO_ATTACHMENT_MIN_TIME,
  RECORD_SAMPLE_RATE,
  TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
  TRANSCRIPTION_BREAK_DURATION,
  TRANSCRIPTION_MAX_CONCURRENT,
  TRANSCRIPTION_MAX_QUEUE,
  TRANSCRIPTION_MAX_RETRIES,
  TRANSCRIPTION_RATE_MIN_TIME,
} from "../constants";
import {
  selectTranscription,
  resolveTranscriptionGuardConfig,
} from "./transcriptionSelectionService";
import { createOpenAIClient } from "./openaiClient";
import { getModelChoice } from "./modelFactory";
import { isLangfuseTracingEnabled } from "./langfuseClient";
import {
  propagateAttributes,
  startActiveObservation,
  updateActiveObservation,
} from "@langfuse/tracing";
import { buildLangfuseTranscriptionAudioAttachment } from "../observability/langfuseAudioAttachment";
import { buildLangfuseTranscriptionAccounting } from "../observability/langfuseUsageDetails";
import { toLangfuseAttributeMetadata } from "../observability/langfuseMetadata";
import { ensureMeetingTempDirSync } from "./tempFileService";
import {
  evaluateNoiseGate,
  DEFAULT_NOISE_GATE_CONFIG,
  isNoiseGateEnabled,
} from "../utils/audioNoiseGate";
import {
  getTranscriptionPrompt,
  getTranscriptionCleanupPrompt,
  getTranscriptionCoalescePrompt,
} from "./transcriptionPromptService";
import { chat } from "./openaiChatService";
import { getMeetingModelOverrides } from "./meetingModelOverrides";
import { getTranscriptionTextQuality } from "../utils/transcriptionText";

type TranscriptionTraceContext = {
  userId: string;
  timestamp: number;
  audioSeconds: number;
  audioBytes: number;
  noiseGateEnabled?: boolean;
  noiseGateMode?: "fast" | "slow";
  noiseGateMetrics?: ReturnType<typeof evaluateNoiseGate>["metrics"];
  suppressionEnabledOverride?: boolean;
};

async function transcribeInternal(
  meeting: MeetingData,
  file: string,
  context?: TranscriptionTraceContext,
): Promise<string> {
  const { prompt, langfusePrompt } = await getTranscriptionPrompt(meeting);
  const promptValue = prompt.trim();
  const resolvedPrompt = promptValue.length > 0 ? promptValue : undefined;
  const passMode = context?.noiseGateMode ?? "slow";
  const voteEnabled = meeting.runtimeConfig?.transcription.voteEnabled ?? true;

  const modelChoice = getModelChoice(
    "transcription",
    getMeetingModelOverrides(meeting),
  );
  const traceMetadata = {
    guildId: meeting.guild.id,
    channelId: meeting.voiceChannel.id,
    meetingId: meeting.meetingId,
    snippetUserId: context?.userId,
    snippetTimestamp: context?.timestamp,
    audioSeconds: context?.audioSeconds,
    audioBytes: context?.audioBytes,
    noiseGateEnabled: context?.noiseGateEnabled,
    noiseGateMode: passMode,
    promptLength: resolvedPrompt?.length ?? 0,
    promptName: langfusePrompt?.name,
    promptVersion: langfusePrompt?.version,
    promptFallback: langfusePrompt?.isFallback ?? false,
    transcriptionVoteEnabled: voteEnabled,
  };

  const runTranscription = async (
    openAIClient: OpenAI,
    promptText?: string,
  ) => {
    const request: TranscriptionCreateParamsNonStreaming<"json"> = {
      file: createReadStream(file),
      model: modelChoice.model,
      language: "en",
      temperature: 0,
      response_format: "json",
      include: ["logprobs"],
      ...(promptText ? { prompt: promptText } : {}),
    };
    const transcription =
      await openAIClient.audio.transcriptions.create(request);
    return {
      text: transcription.text ?? "",
      logprobs: transcription.logprobs ?? [],
      usage: transcription.usage,
    };
  };

  const guardConfig = resolveTranscriptionGuardConfig(
    meeting.runtimeConfig?.transcription,
    context?.suppressionEnabledOverride,
  );

  const toLogSafeTextQuality = (
    quality: ReturnType<typeof getTranscriptionTextQuality>,
  ) => ({
    charCount: quality.charCount,
    wordCount: quality.wordCount,
    alnumCharCount: quality.alnumCharCount,
    punctuationOnly: quality.punctuationOnly,
    trivial: quality.trivial,
    reasons: quality.reasons,
  });
  const runAndSelectTranscription = async (openAIClient: OpenAI) => {
    const selection = await selectTranscription({
      transcribe: (promptText) => runTranscription(openAIClient, promptText),
      prompt: resolvedPrompt,
      passMode,
      voteEnabled,
      guardConfig,
      audioSeconds: context?.audioSeconds,
      noiseGateMetrics: context?.noiseGateMetrics,
      onSyllableError: (error) =>
        console.warn("Failed to count syllables for transcription.", {
          ...traceMetadata,
          error,
        }),
      onCandidate: (candidate) => {
        const {
          guardResult,
          transcriptStats,
          rawTextQuality,
          selectedTextQuality,
        } = candidate;
        if (
          !guardResult.flags.length &&
          !rawTextQuality.trivial &&
          !selectedTextQuality.trivial
        )
          return;
        console.warn("Transcription candidate needs review.", {
          ...traceMetadata,
          transcriptionCandidate: candidate.candidateId,
          candidatePromptLength:
            candidate.candidateId === "prompt"
              ? (resolvedPrompt?.length ?? 0)
              : 0,
          flags: guardResult.flags,
          quietAudio: guardResult.quietAudio,
          quietByPeak: guardResult.quietByPeak,
          quietByActivity: guardResult.quietByActivity,
          hardSilenceDetected: guardResult.hardSilenceDetected,
          rateMismatchDetected: guardResult.rateMismatchDetected,
          suppressionEnabled: candidate.suppressionEnabled,
          promptEchoEnabled: candidate.promptEchoEnabled,
          hardSilenceDbfs: candidate.hardSilenceDbfs,
          rateMaxSeconds: candidate.rateMaxSeconds,
          rateMinWords: candidate.rateMinWords,
          rateMinSyllables: candidate.rateMinSyllables,
          maxSyllablesPerSecond: candidate.maxSyllablesPerSecond,
          logprobMetrics: guardResult.logprobMetrics,
          promptEchoDetected: guardResult.promptEchoDetected,
          promptEchoMetrics: guardResult.promptEchoMetrics,
          noiseGateMetrics: context?.noiseGateMetrics,
          rawTranscriptionLength: transcriptStats.transcriptCharCount,
          ...transcriptStats,
          rawTextQuality: toLogSafeTextQuality(rawTextQuality),
          selectedTextQuality: toLogSafeTextQuality(selectedTextQuality),
          transcriptionLength: guardResult.text.length,
        });
      },
    });
    const { voteDecision, noPromptCandidate, promptCandidate, voteGate } =
      selection;
    if (voteDecision && noPromptCandidate)
      console.log("Transcription vote selected candidate.", {
        ...traceMetadata,
        voteGateReasons: voteGate.reasons,
        voteDecisionReasons: voteDecision.reasons,
        voteSelectedCandidate: voteDecision.selectedId,
        votePromptScore: voteDecision.promptScore,
        voteNoPromptScore: voteDecision.noPromptScore,
        votePromptFlags: promptCandidate.guardResult.flags,
        voteNoPromptFlags: noPromptCandidate.guardResult.flags,
        votePromptSuppressed: promptCandidate.guardResult.suppressed,
        voteNoPromptSuppressed: noPromptCandidate.guardResult.suppressed,
        votePromptTrivialText: promptCandidate.selectedTextQuality.trivial,
        votePromptTrivialReasons: promptCandidate.selectedTextQuality.reasons,
        voteNoPromptTrivialText: noPromptCandidate.selectedTextQuality.trivial,
        voteNoPromptTrivialReasons:
          noPromptCandidate.selectedTextQuality.reasons,
      });
    return selection;
  };

  if (!isLangfuseTracingEnabled()) {
    const openAIClient = createOpenAIClient({
      traceName: "transcription",
      generationName: "transcription",
      userId: meeting.creator.id,
      sessionId: meeting.meetingId,
      tags: ["feature:transcription"],
      metadata: traceMetadata,
      langfusePrompt,
    });
    const selection = await runAndSelectTranscription(openAIClient);
    return selection.selected.guardResult.text;
  }

  return await propagateAttributes(
    {
      traceName: "transcription",
      userId: context?.userId,
      tags: ["feature:transcription"],
      metadata: toLangfuseAttributeMetadata(traceMetadata),
    },
    async () =>
      startActiveObservation(
        "transcription",
        async () => {
          const observationInput = {
            language: "en",
            ...(resolvedPrompt ? { prompt: resolvedPrompt } : {}),
          };
          updateActiveObservation(
            {
              input: observationInput,
              model: modelChoice.model,
              modelParameters: {
                temperature: 0,
                response_format: "json",
                include: "logprobs",
              },
              metadata: traceMetadata,
            },
            { asType: "generation" },
          );

          void langfuseAttachmentLimiter
            .schedule(() => buildLangfuseTranscriptionAudioAttachment(file))
            .then((audioAttachment) => {
              if (!audioAttachment) return;
              updateActiveObservation(
                {
                  input: {
                    ...observationInput,
                    audio: audioAttachment.media,
                  },
                  metadata: {
                    audioAttachmentBytes: audioAttachment.byteLength,
                    audioAttachmentContentType: audioAttachment.contentType,
                  },
                },
                { asType: "generation" },
              );
            })
            .catch((error) => {
              console.warn(
                "Failed to attach transcription audio to Langfuse.",
                error,
              );
            });

          const openAIClient = createOpenAIClient({
            disableTracing: true,
            langfusePrompt,
          });
          const selection = await runAndSelectTranscription(openAIClient);
          const {
            guardResult,
            transcriptStats,
            suppressionEnabled,
            promptEchoEnabled,
            hardSilenceDbfs,
            rateMaxSeconds,
            rateMinWords,
            rateMinSyllables,
            maxSyllablesPerSecond,
          } = selection.selected;

          const accounting = buildLangfuseTranscriptionAccounting(
            [
              selection.promptCandidate.usage,
              ...(selection.noPromptCandidate
                ? [selection.noPromptCandidate.usage]
                : []),
            ],
            context?.audioSeconds,
          );
          if (accounting.unpricedRequestCount > 0) {
            console.warn("Transcription cost accounting is incomplete.", {
              ...traceMetadata,
              transcriptionCostAccountingStatus: accounting.status,
              transcriptionRequestCount: accounting.requestCount,
              transcriptionPricedRequestCount: accounting.pricedRequestCount,
              transcriptionUnpricedRequestCount:
                accounting.unpricedRequestCount,
            });
          }
          updateActiveObservation(
            {
              output: guardResult.text,
              usageDetails: accounting.usageDetails,
              metadata: {
                transcriptionCostAccountingStatus: accounting.status,
                transcriptionRequestCount: accounting.requestCount,
                transcriptionPricedRequestCount: accounting.pricedRequestCount,
                transcriptionUnpricedRequestCount:
                  accounting.unpricedRequestCount,
                transcriptionFlags: guardResult.flags,
                transcriptionCandidate: selection.selected.candidateId,
                quietAudio: guardResult.quietAudio,
                quietByPeak: guardResult.quietByPeak,
                quietByActivity: guardResult.quietByActivity,
                hardSilenceDetected: guardResult.hardSilenceDetected,
                suppressionEnabled,
                promptEchoEnabled,
                hardSilenceDbfs,
                rateMaxSeconds,
                rateMinWords,
                rateMinSyllables,
                maxSyllablesPerSecond,
                ...transcriptStats,
                transcriptionRawTextTrivial:
                  selection.selected.rawTextQuality.trivial,
                transcriptionRawTextReasons:
                  selection.selected.rawTextQuality.reasons,
                transcriptionTextTrivial:
                  selection.selected.selectedTextQuality.trivial,
                transcriptionTextReasons:
                  selection.selected.selectedTextQuality.reasons,
                transcriptionAlnumCharCount:
                  selection.selected.selectedTextQuality.alnumCharCount,
                logprobMetrics: guardResult.logprobMetrics,
                promptEchoDetected: guardResult.promptEchoDetected,
                promptEchoMetrics: guardResult.promptEchoMetrics,
                rateMismatchDetected: guardResult.rateMismatchDetected,
                noiseGateEnabled: context?.noiseGateEnabled,
                noiseGateMode: passMode,
                noiseGateMetrics: context?.noiseGateMetrics,
                suppressed: guardResult.suppressed,
                transcriptionVoteEnabled: voteEnabled,
                transcriptionVoteGateReasons: selection.voteGate.reasons,
                transcriptionVoteAttempted: Boolean(
                  selection.noPromptCandidate,
                ),
                transcriptionVoteSelected: selection.selected.candidateId,
                transcriptionVoteDecisionReasons:
                  selection.voteDecision?.reasons,
                transcriptionVotePromptScore:
                  selection.voteDecision?.promptScore,
                transcriptionVoteNoPromptScore:
                  selection.voteDecision?.noPromptScore,
                transcriptionVotePromptFlags:
                  selection.promptCandidate.guardResult.flags,
                transcriptionVoteNoPromptFlags:
                  selection.noPromptCandidate?.guardResult.flags,
                transcriptionVotePromptTrivialText:
                  selection.promptCandidate.selectedTextQuality.trivial,
                transcriptionVotePromptTrivialReasons:
                  selection.promptCandidate.selectedTextQuality.reasons,
                transcriptionVoteNoPromptTrivialText:
                  selection.noPromptCandidate?.selectedTextQuality.trivial,
                transcriptionVoteNoPromptTrivialReasons:
                  selection.noPromptCandidate?.selectedTextQuality.reasons,
              },
            },
            { asType: "generation" },
          );

          return guardResult.text;
        },
        { asType: "generation" },
      ),
  );
}

const retryPolicy = retry(handleAll, {
  maxAttempts: TRANSCRIPTION_MAX_RETRIES,
  backoff: new ExponentialBackoff(),
});
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: TRANSCRIPTION_BREAK_DURATION,
  breaker: new ConsecutiveBreaker(
    TRANSCRIPTION_BREAK_AFTER_CONSECUTIVE_FAILURES,
  ),
});
const bulkheadPolicy = bulkhead(
  TRANSCRIPTION_MAX_CONCURRENT,
  TRANSCRIPTION_MAX_QUEUE,
);

const policies = wrap(bulkheadPolicy, breakerPolicy, retryPolicy);

const limiter = new Bottleneck({
  minTime: TRANSCRIPTION_RATE_MIN_TIME,
});

const langfuseAttachmentLimiter = new Bottleneck({
  maxConcurrent: LANGFUSE_AUDIO_ATTACHMENT_MAX_CONCURRENT,
  minTime: LANGFUSE_AUDIO_ATTACHMENT_MIN_TIME,
});

async function transcribe(
  meeting: MeetingData,
  file: string,
  context?: TranscriptionTraceContext,
): Promise<string> {
  return await policies.execute(() =>
    limiter.schedule(() => transcribeInternal(meeting, file, context)),
  );
}

type TempSnippetFiles = {
  pcmFile: string;
  wavFile: string;
};

const buildSnippetTempFiles = (
  meeting: MeetingData,
  snippet: AudioSnippet,
  suffix: string,
): TempSnippetFiles => {
  const tempDir = ensureMeetingTempDirSync(meeting);
  return {
    pcmFile: path.join(
      tempDir,
      `temp_snippet_${snippet.userId}_${snippet.timestamp}${suffix}_transcript.pcm`,
    ),
    wavFile: path.join(
      tempDir,
      `temp_snippet_${snippet.userId}_${snippet.timestamp}${suffix}.wav`,
    ),
  };
};

const buildAudioStats = (buffer: Buffer) => {
  const audioBytes = buffer.length;
  const audioSeconds =
    audioBytes / (RECORD_SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
  return { audioBytes, audioSeconds };
};

const resolveSuppressionEnabled = (
  meeting: MeetingData,
  override?: boolean,
): boolean =>
  override ?? meeting.runtimeConfig?.transcription.suppressionEnabled ?? true;

const resolveNoiseGateContext = (input: {
  meeting: MeetingData;
  buffer: Buffer;
  suppressionEnabled: boolean;
  noiseGateMode?: "fast" | "slow";
  noiseGateEnabledOverride?: boolean;
}) => {
  const noiseGateConfig =
    input.meeting.runtimeConfig?.transcription.noiseGate ??
    DEFAULT_NOISE_GATE_CONFIG;
  const noiseGateMode = input.noiseGateMode ?? "slow";
  const noiseGateEnabled =
    input.noiseGateEnabledOverride ??
    isNoiseGateEnabled(noiseGateConfig, noiseGateMode);
  const shouldComputeMetrics =
    input.buffer.length > 0 && (noiseGateEnabled || input.suppressionEnabled);
  const noiseGateMetrics = shouldComputeMetrics
    ? evaluateNoiseGate(input.buffer, noiseGateConfig, {
        sampleRate: RECORD_SAMPLE_RATE,
        channels: CHANNELS,
        bytesPerSample: BYTES_PER_SAMPLE,
      }).metrics
    : undefined;

  return { noiseGateEnabled, noiseGateMetrics };
};

const cleanupTempFile = (filePath: string, label: string) => {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return;
    }
    console.log(`failed cleaning up temp ${label} file, continuing`);
  } catch {
    console.warn(`Failed cleaning up temp ${label} file, continuing.`);
  }
};

const cleanupTempFiles = (files: TempSnippetFiles) => {
  cleanupTempFile(files.pcmFile, "pcm");
  cleanupTempFile(files.wavFile, "wav");
};

export async function transcribeSnippet(
  meeting: MeetingData,
  snippet: AudioSnippet,
  options: {
    tempSuffix?: string;
    noiseGateMode?: "fast" | "slow";
    noiseGateEnabledOverride?: boolean;
    suppressionEnabledOverride?: boolean;
  } = {},
): Promise<SnippetTranscriptionResult> {
  const suffix = options.tempSuffix ? `_${options.tempSuffix}` : "";
  const tempFiles = buildSnippetTempFiles(meeting, snippet, suffix);
  const buffer = Buffer.concat(snippet.chunks);
  const { audioBytes, audioSeconds } = buildAudioStats(buffer);
  const suppressionEnabled = resolveSuppressionEnabled(
    meeting,
    options.suppressionEnabledOverride,
  );
  const resolvedNoiseGateMode = options.noiseGateMode ?? "slow";
  const { noiseGateEnabled, noiseGateMetrics } = resolveNoiseGateContext({
    meeting,
    buffer,
    suppressionEnabled,
    noiseGateMode: resolvedNoiseGateMode,
    noiseGateEnabledOverride: options.noiseGateEnabledOverride,
  });

  let stage: "conversion" | "transcription" = "conversion";
  try {
    writeFileSync(tempFiles.pcmFile, buffer);
    await convertTranscriptionPcmToWav(tempFiles.pcmFile, tempFiles.wavFile);
    stage = "transcription";
    const text = await transcribe(meeting, tempFiles.wavFile, {
      userId: snippet.userId,
      timestamp: snippet.timestamp,
      audioSeconds,
      audioBytes,
      noiseGateEnabled,
      noiseGateMode: resolvedNoiseGateMode,
      noiseGateMetrics,
      suppressionEnabledOverride: options.suppressionEnabledOverride,
    });
    return { status: "succeeded", text };
  } catch (error) {
    const providerError = error as { status?: unknown; code?: unknown };
    const failureLabel = stage === "conversion" ? "convert" : "transcribe";
    console.error(
      `Failed to ${failureLabel} snippet for user ${snippet.userId}.`,
      {
        status:
          typeof providerError.status === "number"
            ? providerError.status
            : undefined,
        code:
          typeof providerError.code === "number"
            ? providerError.code
            : undefined,
      },
    );
    return {
      status: "failed",
      reason:
        stage === "conversion" ? "conversion_error" : "transcription_error",
    };
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

type CoalesceInput = {
  slowTranscript: string;
  fastTranscripts: TranscriptVariant[];
};

export async function cleanupTranscription(
  meeting: MeetingData,
  transcription: string,
) {
  const { messages, langfusePrompt } = await getTranscriptionCleanupPrompt(
    meeting,
    transcription,
  );
  const modelChoice = getModelChoice(
    "transcriptionCleanup",
    getMeetingModelOverrides(meeting),
  );
  return await chat(
    meeting,
    {
      messages: [...messages],
    },
    {
      model: modelChoice.model,
      traceName: "transcription-cleanup",
      generationName: "transcription-cleanup",
      tags: ["feature:transcription_cleanup"],
      langfusePrompt,
      parentSpanContext: meeting.langfuseParentSpanContext,
      modelParamRole: "transcriptionCleanup",
    },
  );
}

export async function coalesceTranscription(
  meeting: MeetingData,
  input: CoalesceInput,
): Promise<string> {
  const { messages, langfusePrompt } = await getTranscriptionCoalescePrompt(
    meeting,
    input,
  );
  const modelChoice = getModelChoice(
    "transcriptionCoalesce",
    getMeetingModelOverrides(meeting),
  );
  return await chat(
    meeting,
    {
      messages: [...messages],
    },
    {
      model: modelChoice.model,
      traceName: "transcription-coalesce",
      generationName: "transcription-coalesce",
      tags: ["feature:transcription_coalesce"],
      langfusePrompt,
      parentSpanContext: meeting.langfuseParentSpanContext,
      modelParamRole: "transcriptionCoalesce",
    },
  );
}
