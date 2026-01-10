import { distance as levenshteinDistance } from "fastest-levenshtein";
import { TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD } from "../constants";

type PromptSimilarityInput = {
  transcription: string;
  fullPrompt: string;
  glossaryContent: string;
  threshold?: number;
};

export type PromptSimilarityMetrics = {
  similarityFull: number;
  similarityContent: number;
  similarityFirstLine: number;
  isPromptLike: boolean;
};

const normalizeValue = (value: string) => value.trim().toLowerCase();

export function getPromptSimilarityMetrics(
  input: PromptSimilarityInput,
): PromptSimilarityMetrics {
  const normalizedTranscription = normalizeValue(input.transcription);
  const normalizedPrompt = normalizeValue(input.fullPrompt);
  const normalizedGlossary = normalizeValue(input.glossaryContent);
  const firstLineOfGlossary = normalizeValue(
    input.glossaryContent.split("\n")[0] ?? "",
  );

  const distanceFull = levenshteinDistance(
    normalizedTranscription,
    normalizedPrompt,
  );
  const distanceContent = levenshteinDistance(
    normalizedTranscription,
    normalizedGlossary,
  );
  const distanceFirstLine = levenshteinDistance(
    normalizedTranscription,
    firstLineOfGlossary,
  );

  const maxLengthFull = Math.max(
    normalizedTranscription.length,
    normalizedPrompt.length,
  );
  const maxLengthContent = Math.max(
    normalizedTranscription.length,
    normalizedGlossary.length,
  );
  const maxLengthFirstLine = Math.max(
    normalizedTranscription.length,
    firstLineOfGlossary.length,
  );

  // These are normalized edit distance ratios, lower means more similar.
  const similarityFull = maxLengthFull > 0 ? distanceFull / maxLengthFull : 0;
  const similarityContent =
    maxLengthContent > 0 ? distanceContent / maxLengthContent : 0;
  const similarityFirstLine =
    maxLengthFirstLine > 0 ? distanceFirstLine / maxLengthFirstLine : 0;

  const threshold =
    input.threshold ?? TRANSCRIPTION_PROMPT_SIMILARITY_THRESHOLD;

  return {
    similarityFull,
    similarityContent,
    similarityFirstLine,
    isPromptLike:
      similarityFull < threshold ||
      similarityContent < threshold ||
      similarityFirstLine < threshold,
  };
}

export type GlossaryTermsInput = {
  serverName?: string;
  channelName?: string;
  dictionaryTerms?: string[];
};

export function buildGlossaryTermSet(input: GlossaryTermsInput): Set<string> {
  const terms = new Set<string>();
  const add = (value?: string) => {
    if (!value) return;
    const normalized = normalizeValue(value);
    if (normalized) {
      terms.add(normalized);
    }
  };

  add(input.serverName);
  add(input.channelName);

  (input.dictionaryTerms ?? []).forEach((term) => add(term));

  return terms;
}

export function isGlossaryTermOnlyTranscript(
  transcript: string,
  termSet: Set<string>,
): boolean {
  const trimmed = transcript.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\n")) return false;

  return termSet.has(normalizeValue(trimmed));
}
