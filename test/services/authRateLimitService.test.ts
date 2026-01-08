import { describe, expect, test } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import { createAuthRateLimiter } from "../../src/services/authRateLimitService";

type TestResponse = Response & {
  statusCode: number;
  body?: unknown;
};

const createRequest = (): Request =>
  ({
    ip: "127.0.0.1",
    headers: {},
    app: { get: () => 1 },
  }) as Request;

const createResponse = (onFinish: () => void): TestResponse => {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body?: unknown) {
      this.body = body;
      onFinish();
      return this;
    },
    end(body?: unknown) {
      this.body = body;
      onFinish();
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(
        name.toLowerCase(),
        Array.isArray(value) ? value.join(",") : String(value),
      );
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  } as unknown as TestResponse;

  return response;
};

const runLimiter = async (
  handler: ReturnType<typeof createAuthRateLimiter>,
): Promise<TestResponse> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (res: TestResponse) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const response = createResponse(() => finish(response));
    const request = createRequest();
    const next: NextFunction = (err?: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      finish(response);
    };
    Promise.resolve(handler(request, response, next)).catch(reject);
  });

describe("authRateLimitService", () => {
  test("passes through when disabled", async () => {
    const handler = createAuthRateLimiter({
      enabled: false,
      windowMs: 1000,
      limit: 1,
    });
    const response = await runLimiter(handler);
    expect(response.statusCode).toBe(200);
  });

  test("returns 429 after limit exceeded", async () => {
    const handler = createAuthRateLimiter({
      enabled: true,
      windowMs: 1000,
      limit: 2,
    });
    await runLimiter(handler);
    await runLimiter(handler);
    const response = await runLimiter(handler);
    expect(response.statusCode).toBe(429);
  });
});
