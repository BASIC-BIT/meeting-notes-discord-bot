import { expect, jest, test } from "@jest/globals";

async function loadResponse(response: object) {
  jest.resetModules();
  const responsesCreate = jest.fn().mockResolvedValue(response);
  const completionCreate = jest.fn().mockResolvedValue({
    choices: [
      { finish_reason: "stop", message: { content: "Legacy transport" } },
    ],
  });
  jest.doMock("../../src/services/openaiClient", () => ({
    createOpenAIClient: jest.fn(() => ({
      responses: { create: responsesCreate },
      chat: { completions: { create: completionCreate } },
    })),
    buildOpenAISafetyIdentifier: jest.fn(() => "safety-id"),
  }));
  jest.doMock("../../src/services/modelFactory", () => ({
    getModelChoice: jest.fn(() => ({ model: "gpt-6.1-sol" })),
  }));
  jest.doMock("../../src/services/meetingModelOverrides", () => ({
    getMeetingModelOverrides: jest.fn(),
  }));
  jest.doMock("../../src/services/openaiModelParams", () => ({
    resolveChatParamsForRole: jest.fn(() => ({
      reasoning_effort: "low",
      verbosity: "low",
    })),
  }));
  const { chat } = await import("../../src/services/openaiChatService");
  const meeting = {
    meetingId: "meeting-1",
    creator: { id: "user-1" },
    guild: { id: "guild-1" },
    voiceChannel: { id: "voice-1" },
  };
  const options = { traceName: "notes", api: "responses" as const };
  const messages = [{ role: "user" as const, content: "Write the notes." }];
  return {
    run: () => chat(meeting, { messages }, options),
    responsesCreate,
    completionCreate,
    messages,
  };
}

test("Responses returns completed text and translates frozen-style parameters", async () => {
  const fixture = await loadResponse({
    status: "completed",
    output_text: "Completed notes",
    output: [
      { type: "reasoning", id: "reasoning-1", summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Completed notes" }],
      },
    ],
  });

  await expect(fixture.run()).resolves.toBe("Completed notes");
  expect(fixture.completionCreate).not.toHaveBeenCalled();
  expect(fixture.responsesCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "gpt-6.1-sol",
      input: fixture.messages,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      store: false,
      safety_identifier: "safety-id",
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(fixture.messages).toEqual([
    { role: "user", content: "Write the notes." },
  ]);
});

test("Responses refuses to publish a refused generation", async () => {
  const fixture = await loadResponse({
    status: "completed",
    output_text: "",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "refusal", refusal: "Cannot provide these notes." }],
      },
    ],
  });

  await expect(fixture.run()).rejects.toThrow(/refus/i);
});

test("Responses refuses to publish content-filtered partial text", async () => {
  const fixture = await loadResponse({
    status: "incomplete",
    incomplete_details: { reason: "content_filter" },
    output_text: "Partial notes",
    output: [],
  });

  await expect(fixture.run()).rejects.toThrow(/incomplete/i);
});

test("Responses rejects a completed generation without usable text", async () => {
  const fixture = await loadResponse({
    status: "completed",
    output_text: "   ",
    output: [],
  });

  await expect(fixture.run()).rejects.toThrow(/empty/i);
});
