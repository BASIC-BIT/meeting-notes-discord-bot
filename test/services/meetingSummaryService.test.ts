import { afterEach, expect, jest, test } from "@jest/globals";

afterEach(() => {
  jest.resetModules();
  jest.dontMock("openai");
});

test("parseMeetingSummaryResponse trims summaries", async () => {
  const { parseMeetingSummaryResponse } = await import(
    "../../src/services/meetingSummaryService"
  );
  const parsed = parseMeetingSummaryResponse(
    '{"summarySentence":"  A short summary.  ","summaryLabel":"  Weekly sync "}',
  );
  expect(parsed).toEqual({
    summarySentence: "A short summary.",
    summaryLabel: "Weekly sync",
  });
});

test("parseMeetingSummaryResponse returns undefined on empty input", async () => {
  const { parseMeetingSummaryResponse } = await import(
    "../../src/services/meetingSummaryService"
  );
  const parsed = parseMeetingSummaryResponse(" ");
  expect(parsed).toBeUndefined();
});

test("parseMeetingSummaryResponse drops invalid summaries", async () => {
  const { parseMeetingSummaryResponse } = await import(
    "../../src/services/meetingSummaryService"
  );
  const parsed = parseMeetingSummaryResponse(
    '{"summarySentence":"First sentence. Second sentence.","summaryLabel":"Too many words in this label"}',
  );
  expect(parsed).toBeUndefined();
});

test("parseMeetingSummaryResponse keeps valid sentence when label is invalid", async () => {
  const { parseMeetingSummaryResponse } = await import(
    "../../src/services/meetingSummaryService"
  );
  const parsed = parseMeetingSummaryResponse(
    '{"summarySentence":"A single sentence.","summaryLabel":"Weekly sync!"}',
  );
  expect(parsed).toEqual({
    summarySentence: "A single sentence.",
    summaryLabel: undefined,
  });
});

test("generateMeetingSummaries builds prompts and parses response", async () => {
  const mockCreate = jest.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content:
            '{"summarySentence":"One sentence.","summaryLabel":"Weekly sync"}',
        },
      },
    ],
  });
  const mockGetLangfuseChatPrompt = jest
    .fn()
    .mockImplementation(({ variables }) => ({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: [
            `Today is ${variables?.todayLabel ?? ""}.`,
            `Server: ${variables?.serverName ?? ""}`,
            `Channel: ${variables?.channelName ?? ""}`,
            `Tags: ${variables?.tagLine ?? ""}`,
            `${variables?.previousSummaryBlock ?? ""}`,
            "Notes:",
            `${variables?.notes ?? ""}`,
          ]
            .filter((line) => line.trim().length > 0)
            .join("\n"),
        },
      ],
      source: "langfuse",
      langfusePrompt: {
        name: "chronote-meeting-summary-chat",
        version: 1,
        isFallback: true,
      },
    }));
  jest.doMock("openai", () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  }));
  jest.doMock("../../src/services/langfusePromptService", () => ({
    __esModule: true,
    getLangfuseChatPrompt: mockGetLangfuseChatPrompt,
  }));

  const { generateMeetingSummaries } = await import(
    "../../src/services/meetingSummaryService"
  );
  const { config } = await import("../../src/services/configService");

  const now = new Date("2025-02-03T12:00:00Z");
  const expectedDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const result = await generateMeetingSummaries({
    notes: "These are the notes.",
    serverName: "Chronote HQ",
    channelName: "general",
    tags: ["alpha", "beta"],
    now,
    previousSummarySentence: "Old summary.",
    previousSummaryLabel: "Old label",
  });

  expect(result).toEqual({
    summarySentence: "One sentence.",
    summaryLabel: "Weekly sync",
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const call = mockCreate.mock.calls[0][0];
  expect(call.model).toBe(config.notes.model);
  expect(call.temperature).toBe(0);
  expect(call.response_format).toEqual({ type: "json_object" });
  const userPrompt = call.messages[1].content;
  expect(userPrompt).toContain(`Today is ${expectedDate}.`);
  expect(userPrompt).toContain("Server: Chronote HQ");
  expect(userPrompt).toContain("Channel: general");
  expect(userPrompt).toContain("Tags: alpha, beta");
  expect(userPrompt).toContain("Previous summary sentence: Old summary.");
  expect(userPrompt).toContain("Previous summary label: Old label");
  expect(userPrompt).toContain("Notes:");
  expect(userPrompt).toContain("These are the notes.");
});

test("generateMeetingSummaries returns empty object on error", async () => {
  const mockCreate = jest.fn().mockRejectedValue(new Error("boom"));
  const mockGetLangfuseChatPrompt = jest.fn().mockResolvedValue({
    messages: [{ role: "system", content: "You are a helpful assistant." }],
    source: "langfuse",
    langfusePrompt: {
      name: "chronote-meeting-summary-chat",
      version: 1,
      isFallback: true,
    },
  });
  jest.doMock("openai", () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  }));
  jest.doMock("../../src/services/langfusePromptService", () => ({
    __esModule: true,
    getLangfuseChatPrompt: mockGetLangfuseChatPrompt,
  }));

  const { generateMeetingSummaries } = await import(
    "../../src/services/meetingSummaryService"
  );

  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const result = await generateMeetingSummaries({
    notes: "Notes",
    serverName: "Chronote",
    channelName: "general",
  });
  expect(result).toEqual({});
  expect(errorSpy).toHaveBeenCalled();
  errorSpy.mockRestore();
});
