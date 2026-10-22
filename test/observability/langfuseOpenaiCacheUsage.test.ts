/** @jest-environment node */
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";

const mockUpdate = jest.fn();

jest.mock("@langfuse/tracing", () => ({
  propagateAttributes: (_attributes: unknown, callback: () => unknown) =>
    callback(),
  startObservation: () => ({
    update: mockUpdate.mockReturnThis(),
    end: jest.fn(),
  }),
}));

beforeEach(() => {
  mockUpdate.mockClear();
});

describe("Langfuse Responses cache usage", () => {
  it.each([
    {
      name: "flat cache counts",
      inputDetails: { cached_tokens: 200, cache_write_tokens: 300 },
      expectedInput: 500,
    },
    {
      name: "a nested cache write breakdown with zero counts",
      inputDetails: {
        cached_tokens: 0,
        cache_write_tokens: 0,
        cache_write_tokens_details: {
          ttl_30m_tokens: 0,
          ttl_12h_tokens: 0,
        },
      },
      expectedInput: 1000,
    },
    {
      name: "a nested cache write breakdown with read and write counts",
      inputDetails: {
        cached_tokens: 200,
        cache_write_tokens: 300,
        cache_write_tokens_details: {
          ttl_30m_tokens: 100,
          ttl_12h_tokens: 200,
        },
      },
      expectedInput: 500,
    },
  ])("records finite numeric usage for $name", async ({
    inputDetails,
    expectedInput,
  }) => {
    const providerUsage = {
      input_tokens: 1000,
      input_tokens_details: inputDetails,
      output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 20 },
      total_tokens: 1100,
    };
    const providerResponse = {
      id: "resp_synthetic_cache_usage",
      object: "response",
      created_at: 0,
      status: "completed",
      model: "synthetic",
      output: [],
      usage: providerUsage,
    };
    const fetch = jest.fn(async () => Response.json(providerResponse));
    const client = observeOpenAI(
      new OpenAI({ apiKey: "synthetic", fetch, maxRetries: 0 }),
    );

    const response = await client.responses.create({
      model: "synthetic",
      input: "synthetic",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject(providerResponse);
    expect(response.usage).toEqual(providerUsage);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const usageDetails = mockUpdate.mock.calls[0][0].usageDetails;
    expect(usageDetails).toEqual({
      input: expectedInput,
      output: 80,
      total: 1100,
      input_cached_tokens: inputDetails.cached_tokens,
      input_cache_write_tokens: inputDetails.cache_write_tokens,
      output_reasoning_tokens: 20,
    });
    expect(
      Object.values(usageDetails).every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    ).toBe(true);
  });
});
