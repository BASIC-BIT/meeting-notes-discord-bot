import {
  buildLangfuseTranscriptionUsageDetails,
  LANGFUSE_AUDIO_SECONDS_USAGE_KEY,
} from "../../src/observability/langfuseUsageDetails";

describe("buildLangfuseTranscriptionUsageDetails", () => {
  it("returns undefined for missing or non-positive values", () => {
    expect(buildLangfuseTranscriptionUsageDetails()).toBeUndefined();
    expect(buildLangfuseTranscriptionUsageDetails(Number.NaN)).toBeUndefined();
    expect(buildLangfuseTranscriptionUsageDetails(0)).toBeUndefined();
    expect(buildLangfuseTranscriptionUsageDetails(-1)).toBeUndefined();
  });

  it("returns a rounded input_audio_seconds usage detail", () => {
    const result = buildLangfuseTranscriptionUsageDetails(12.34567);

    expect(result).toEqual({
      [LANGFUSE_AUDIO_SECONDS_USAGE_KEY]: 12.346,
    });
  });
});
