import {
  buildGlossaryTermSet,
  getPromptSimilarityMetrics,
  isGlossaryTermOnlyTranscript,
} from "../../src/utils/transcriptionGuards";

describe("transcriptionGuards", () => {
  test("getPromptSimilarityMetrics flags prompt-like outputs", () => {
    const metrics = getPromptSimilarityMetrics({
      transcription: "Server Name: Test",
      fullPrompt: "Server Name: Test",
      glossaryContent: "Server Name: Test\nChannel: Voice",
    });

    expect(metrics.isPromptLike).toBe(true);
    expect(metrics.similarityFull).toBe(0);
  });

  test("getPromptSimilarityMetrics ignores different text", () => {
    const metrics = getPromptSimilarityMetrics({
      transcription: "This is a spoken sentence.",
      fullPrompt: "Server Name: Test",
      glossaryContent: "Server Name: Test\nChannel: Voice",
    });

    expect(metrics.isPromptLike).toBe(false);
  });

  test("isGlossaryTermOnlyTranscript matches single-line terms", () => {
    const termSet = buildGlossaryTermSet({
      serverName: "The Faceless",
      channelName: "Hall of Faces",
      dictionaryTerms: ["Vket", "The Den"],
    });

    expect(isGlossaryTermOnlyTranscript("The Faceless", termSet)).toBe(true);
    expect(isGlossaryTermOnlyTranscript("the den", termSet)).toBe(true);
    expect(isGlossaryTermOnlyTranscript("not a term", termSet)).toBe(false);
    expect(
      isGlossaryTermOnlyTranscript("The Faceless\nSecond line", termSet),
    ).toBe(false);
  });
});
