import type { MeetingData } from "../src/types/meeting-data";
import { applyTranscriptionGuards } from "../src/transcription";

describe("applyTranscriptionGuards", () => {
  const baseMeeting = {
    guild: { name: "Test Guild" },
    voiceChannel: { name: "General" },
    dictionaryEntries: [],
  } as MeetingData;

  test("suppresses prompt-like output when suppression is enabled", () => {
    const meeting = {
      ...baseMeeting,
      runtimeConfig: {
        transcription: {
          suppressionEnabled: true,
        },
      },
    } as MeetingData;

    const prompt = "Server Name: Test Guild\nChannel: General";

    const result = applyTranscriptionGuards(meeting, prompt, prompt, prompt, {
      userId: "user-1",
      timestamp: 0,
      audioSeconds: 0.5,
      audioBytes: 48000,
    });

    expect(result.text).toBe("");
    expect(result.flags).toEqual(
      expect.arrayContaining(["prompt_like", "prompt_suppressed"]),
    );
  });

  test("returns raw transcription when suppression is disabled", () => {
    const meeting = {
      ...baseMeeting,
      runtimeConfig: {
        transcription: {
          suppressionEnabled: false,
        },
      },
    } as MeetingData;

    const prompt = "Server Name: Test Guild\nChannel: General";

    const result = applyTranscriptionGuards(meeting, prompt, prompt, prompt, {
      userId: "user-1",
      timestamp: 0,
      audioSeconds: 0.5,
      audioBytes: 48000,
    });

    expect(result.text).toBe(prompt);
    expect(result.flags).toEqual([]);
  });
});
