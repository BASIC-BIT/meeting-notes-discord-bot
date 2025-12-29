import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_TTS_VOICE,
  isSupportedTtsVoice,
  normalizeTtsVoice,
  resolveTtsVoice,
} from "../../src/utils/ttsVoices";

describe("tts voice helpers", () => {
  test("normalizes supported voices", () => {
    expect(normalizeTtsVoice(" Alloy ")).toBe("alloy");
  });

  test("returns undefined for unsupported voices", () => {
    expect(normalizeTtsVoice("unknown")).toBeUndefined();
  });

  test("detects supported voices", () => {
    expect(isSupportedTtsVoice("nova")).toBe(true);
    expect(isSupportedTtsVoice("nope")).toBe(false);
  });

  test("resolves preferred then fallback then default", () => {
    expect(resolveTtsVoice("shimmer", "alloy")).toBe("shimmer");
    expect(resolveTtsVoice("nope", "sage")).toBe("sage");
    expect(resolveTtsVoice(null, null)).toBe(DEFAULT_TTS_VOICE);
  });
});
