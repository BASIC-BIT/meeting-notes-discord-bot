/** @jest-environment node */
import { awsCaller } from "../../scripts/deployment/sandbox-manifest.cjs";

// Run a generated CLI child, never the AWS executable or any provider endpoint.
jest.mock("node:child_process", () => {
  const actual =
    jest.requireActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  const { promisify } =
    jest.requireActual<typeof import("node:util")>("node:util");
  const execute = promisify(actual.execFile);
  const generatedCli = `process.stdout.write(JSON.stringify({
    ignoreConfiguredEndpoints: process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS,
    attempts: process.env.AWS_MAX_ATTEMPTS,
    retryMode: process.env.AWS_RETRY_MODE,
    region: process.argv[process.argv.indexOf("--region") + 1]
  }));`;
  return {
    execFile: Object.assign(jest.fn(), {
      [promisify.custom]: (
        file: string,
        args: string[],
        options: import("node:child_process").ExecFileOptions,
      ) => {
        expect(file).toBe("aws");
        expect(args).not.toContain("--endpoint-url");
        expect(args).toContain("--no-paginate");
        return execute(
          process.execPath,
          ["-e", generatedCli, ...args],
          options,
        );
      },
    }),
  };
});

const previous = { ...process.env };
afterEach(() => {
  process.env = { ...previous };
});

test.each([undefined, "false"])(
  "shared-config endpoint overrides are disabled even when inherited setting is %s",
  async (inherited) => {
    if (inherited === undefined)
      delete process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS;
    else process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS = inherited;
    process.env.AWS_MAX_ATTEMPTS = "9";
    process.env.AWS_RETRY_MODE = "adaptive";
    expect(
      await awsCaller("us-east-1")("sts", "get-caller-identity", {}),
    ).toEqual({
      ignoreConfiguredEndpoints: "true",
      attempts: "1",
      retryMode: "standard",
      region: "us-east-1",
    });
  },
);

test("explicit endpoint environment overrides still refuse before any child starts", () => {
  process.env.AWS_ENDPOINT_URL_ECS = "http://127.0.0.1:1";
  expect(() => awsCaller("us-east-1")).toThrow("Custom AWS endpoints");
});
