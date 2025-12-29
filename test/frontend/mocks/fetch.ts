import { jest } from "@jest/globals";

type MockFetchValue = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export const setMockFetchResolved = (value: MockFetchValue) => {
  global.fetch = jest.fn().mockResolvedValue(value) as unknown as typeof fetch;
};

export const setMockFetchRejected = (error: Error) => {
  global.fetch = jest.fn().mockRejectedValue(error) as unknown as typeof fetch;
};
